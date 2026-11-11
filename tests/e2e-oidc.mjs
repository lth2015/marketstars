// OIDC 模式端到端验收：模拟 SSO（tests/mock-sso/server.mjs）+ AUTH_MODE=oidc 的 MarketStars（端口 3100）。
// 覆盖 A04（注册/登录回到原应用）、A05（空间切换与隔离）、A11（成员停用、全设备退出后旧会话失效）、A13、A16（SSO 不可用）。
// 前提：已 npm run build，MySQL 可用。用法：node tests/e2e-oidc.mjs
import { createRequire } from "node:module";
import { spawn, execSync } from "node:child_process";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");

const MS = "http://127.0.0.1:3100";
const SSO = "http://127.0.0.1:4464";
const DB = process.env.MYSQL_DB ?? "marketstars";
const U1 = "a1".repeat(16), U2 = "a2".repeat(16), T_SUZUKI = "b1".repeat(16), T_EKIMAE = "b2".repeat(16), T_OPS = "c1".repeat(16);
const sql = (q) => execSync(`mysql --default-character-set=utf8mb4 ${process.env.MYSQL_ARGS ?? ""} -N ${DB} -e "${q.replace(/"/g, '\\"')}"`).toString().trim();

const procs = [];
// detached + 进程组终止，确保子进程（next-server）一起退出
const start = (cmd, args, env) => { const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true }); procs.push(p); return p; };
const waitFor = async (url, ok = (s) => s < 500) => { for (let i = 0; i < 60; i++) { try { const r = await fetch(url); if (ok(r.status)) return; } catch {} await new Promise((r) => setTimeout(r, 500)); } throw new Error(`timeout ${url}`); };
const admin = (op, body = {}) => fetch(`${SSO}/__admin/${op}`, { method: "POST", body: JSON.stringify(body) });

// 端口被旧进程占用时直接失败，避免测到旧代码
for (const port of [3100, 4464]) { try { await fetch(`http://127.0.0.1:${port}/`); throw new Error(`port ${port} already in use`); } catch (e) { if (String(e.message).includes("in use")) throw e; } }
start("node", ["tests/mock-sso/server.mjs"], { PORT: "4464", CLIENT_ID: "marketstars-local", CLIENT_SECRET: "mock-client-secret", REDIRECT_URI: `${MS}/auth/callback`, TOKEN_TTL: "5" });
start("node", ["node_modules/next/dist/bin/next", "start", "-p", "3100"], {
  AUTH_MODE: "oidc", APP_BASE_URL: MS, OIDC_ISSUER: `${SSO}/`, OIDC_CLIENT_ID: "marketstars-local", OIDC_CLIENT_SECRET: "mock-client-secret", OIDC_REDIRECT_URI: `${MS}/auth/callback`,
  OIDC_SCOPES: "openid offline_access platform:read", SSO_API_BASE_URL: SSO, SSO_API_AUDIENCE: "https://api.sso.local", SSO_LOGOUT_URL: `${SSO}/sso/logout`, SSO_ACCOUNT_URL: `${SSO}/account`,
  OPERATOR_SSO_TENANT_ID: T_OPS, SSO_REVERIFY_SECONDS: "1",
});
await waitFor(`${SSO}/.well-known/openid-configuration`);
await waitFor(`${MS}/api/healthz`);
sql(`INSERT IGNORE INTO OperatorGrant (id, userId, role, active, createdAt) VALUES ('og-oidc-test', '${U2}', 'admin', 1, NOW(3))`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(["PASS", name]); console.log("PASS", name); }
  catch (e) { results.push(["FAIL", name]); console.log("FAIL", name, e.message.split("\n")[0], page.url()); }
}
const see = (loc) => loc.first().waitFor({ timeout: 15000 });
async function ssoLogin(tenantName, totp = "123456") {
  await page.waitForURL(/127\.0\.0\.1:4464\/oauth2\/auth/);
  await page.getByLabel(new RegExp(tenantName)).check();
  await page.fill("#totp", totp);
  await page.getByRole("button", { name: "許可して続行" }).click();
}

try {
  await step("O1 (A04) guest → login via SSO with MFA → returns to the app, no auto purchase", async () => {
    await page.goto(`${MS}/apps/pop-writer`);
    await page.locator(".cta-main a", { hasText: "ログインして利用する" }).click();
    await page.getByRole("link", { name: "共通アカウントでログイン" }).click();
    await ssoLogin("鈴木商店");
    await page.waitForURL(`${MS}/apps/pop-writer`);
    await see(page.getByText("空間：鈴木商店"));
    await see(page.locator(".cta-main", { hasText: "日間無料で試す" }));
    assert.equal(sql(`SELECT COUNT(*) FROM Subscription WHERE tenantId='${T_SUZUKI}'`), "0");
  });

  await step("O2 tokens stay server-side: only an HttpOnly session cookie reaches the browser", async () => {
    const cookies = await ctx.cookies(MS);
    const s = cookies.find((c) => c.name === "ms_session");
    assert.ok(s && s.httpOnly);
    assert.equal(await page.evaluate(() => document.cookie.includes("ms_session")), false);
    const stored = sql(`SELECT COUNT(*) FROM Session WHERE userId='${U1}' AND accessToken IS NOT NULL`);
    assert.ok(Number(stored) >= 1);
  });

  let subId;
  await step("O3 MarketStars uses SSO user_id (not the pairwise ID-token sub) for business data", async () => {
    const href = await page.locator(".cta-main a", { hasText: "日間無料で試す" }).getAttribute("href");
    await page.goto(MS + href);
    await page.getByLabel("MarketStars 利用規約に同意します").check();
    await page.getByLabel("提供会社の利用規約・プライバシーポリシーに同意します").check();
    await page.getByRole("button", { name: /日間無料で試す/ }).click();
    await page.waitForURL(/done=1/);
    subId = page.url().split("/my/apps/")[1].split("?")[0];
    assert.equal(sql(`SELECT createdBy FROM Subscription WHERE id='${subId}'`), U1);
  });

  await step("O4 token refresh keeps the session alive past access-token expiry", async () => {
    await page.waitForTimeout(6500);
    await page.goto(`${MS}/my/apps`);
    await see(page.getByText("無料体験中"));
  });

  await step("O5 (A05) switching space re-authorizes; data is isolated and role follows the new space", async () => {
    await page.goto(`${MS}/auth/switch?returnTo=/my/apps`);
    await ssoLogin("駅前カフェ");
    await page.waitForURL(`${MS}/my/apps`);
    await see(page.getByText("空間：駅前カフェ"));
    await see(page.getByText("この空間で利用中のアプリはまだありません"));
    assert.equal((await page.goto(`${MS}/my/apps/${subId}`)).status(), 404);
    await page.goto(`${MS}/apps/review-reply`);
    await see(page.locator(".cta-main", { hasText: "管理者に申し込みを依頼" }));
  });

  await step("O6 (A11) member suspended in SSO → old MarketStars session is rejected", async () => {
    await admin("suspend", { user: U1, tenant: T_EKIMAE });
    await page.waitForTimeout(1500);
    await page.goto(`${MS}/my/apps`);
    await page.waitForURL(/\/auth\/login/);
    await admin("restore", { user: U1, tenant: T_EKIMAE });
  });

  await step("O7 (A11) logout on all devices at SSO → MarketStars session ends", async () => {
    await page.goto(`${MS}/auth/start?returnTo=/my/apps`);
    await ssoLogin("鈴木商店");
    await page.waitForURL(`${MS}/my/apps`);
    await admin("logout-all", { user: U1 });
    await page.waitForTimeout(1500);
    await page.goto(`${MS}/my/apps`);
    await page.waitForURL(/\/auth\/login/);
  });

  await step("O8 app-only logout revokes this app's tokens; global logout goes to SSO confirmation", async () => {
    await page.goto(`${MS}/auth/start?returnTo=/account`);
    await ssoLogin("鈴木商店");
    await page.waitForURL(`${MS}/account`);
    await page.locator("form", { hasText: "ログアウト" }).first().getByRole("button", { name: "ログアウト", exact: true }).click();
    await page.waitForURL(/logged_out=1/);
    assert.equal(sql(`SELECT COUNT(*) FROM Session WHERE userId='${U1}'`), "0");
    await page.goto(`${MS}/auth/start?returnTo=/account`);
    await ssoLogin("鈴木商店");
    await page.waitForURL(`${MS}/account`);
    await page.getByRole("button", { name: "すべての端末からログアウト" }).click();
    await page.waitForURL(/\/sso\/logout/);
    await see(page.getByText("すべての端末からログアウトしました"));
  });

  await step("O9 (A13) operator via SSO operator space can use admin; a tenant owner cannot", async () => {
    await page.goto(`${MS}/auth/start?returnTo=/admin`);
    await ssoLogin("鈴木商店");
    await page.waitForURL(`${MS}/admin`);
    await see(page.getByText("アクセスする権限がありません"));
    await page.goto(`${MS}/auth/switch?returnTo=/admin`);
    await ssoLogin("MarketStars 運営");
    await page.waitForURL(`${MS}/admin`);
    await see(page.getByRole("heading", { name: "ダッシュボード" }));
  });

  await step("O10 (A16) SSO down: catalog still browsable, login shows retry, protected pages fail closed", async () => {
    await admin("down");
    try {
    await page.waitForTimeout(1500);
    await page.goto(`${MS}/my/apps`);
    await page.waitForURL(/\/auth\/login/);
    await page.goto(`${MS}/apps`);
    await see(page.locator(".app-card"));
    await page.goto(`${MS}/auth/start?returnTo=/my/apps`);
    await see(page.getByText("認証サービスに接続できませんでした"));
    } finally { await admin("up"); }
  });

  await step("O11 MFA failure does not create a session; wrong redirect_uri is rejected by SSO", async () => {
    await page.context().clearCookies();
    await page.goto(`${MS}/auth/start?returnTo=/my/apps`);
    await ssoLogin("鈴木商店", "000000");
    await see(page.getByText("MFA failed"));
    const r = await fetch(`${SSO}/oauth2/auth?client_id=marketstars-local&redirect_uri=${encodeURIComponent("https://evil.example/cb")}&response_type=code&code_challenge=x&code_challenge_method=S256&state=s`);
    assert.equal(r.status, 400);
  });
} finally {
  await browser.close();
  sql(`DELETE FROM OperatorGrant WHERE id='og-oidc-test'`);
  for (const p of procs) { try { process.kill(-p.pid, "SIGTERM"); } catch {} }
}
const failed = results.filter((r) => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
