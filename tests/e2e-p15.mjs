// MarketStars ホスティング（静的サイトの zip アップロード → ビルド → 配信・ロールバック）。node tests/e2e-p15.mjs   （demo モード・seed 済み）
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");
const { zipSync, strToU8 } = createRequire(import.meta.url)("fflate");

const BASE = process.argv[2] ?? "http://localhost:3000";
const DB = process.env.MYSQL_DB ?? "marketstars";
const sql = (q) => execSync(`mysql --default-character-set=utf8mb4 ${process.env.MYSQL_ARGS ?? ""} -N ${DB} -e "${q.replace(/"/g, '\\"')}"`).toString().trim();
const browser = await chromium.launch();
const custCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const devCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const anonCtx = await browser.newContext();
const cust = await custCtx.newPage();
const dev = await devCtx.newPage();
let page = cust;
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(["PASS", name]); console.log("PASS", name); }
  catch (e) { results.push(["FAIL", name]); console.log("FAIL", name, e.message.split("\n")[0], page.url()); if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/fail-${name.split(" ")[0]}.png`, fullPage: true }).catch(() => {}); }
}
const see = (loc) => loc.first().waitFor({ timeout: 15000 });
async function login(p, userName, tenantLabel, returnTo = "/") {
  await p.goto(`${BASE}/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  const form = p.locator("form", { hasText: userName });
  await form.locator("select").selectOption({ label: tenantLabel });
  await form.getByRole("button").click();
  await p.waitForLoadState("networkidle");
}
const ENTRY = `${BASE}/hosted/register-close/index.html`;
const version = async (p) => (await p.locator(".ver").textContent())?.trim();

try {
  await step("Q1 a customer opens the hosted app from My apps; it runs sandboxed (scripts work, no access to MarketStars cookies)", async () => {
    page = cust;
    await login(cust, "山田 花子", "ひかり整骨院（オーナー）", "/my/apps");
    await cust.locator(".panel", { hasText: "レジ締めチェック" }).getByRole("link", { name: "アプリを開く" }).click();
    await cust.waitForURL(/\/hosted\/register-close\/index\.html$/);
    await see(cust.getByRole("heading", { name: "レジ締めチェック" }));
    assert.equal(await version(cust), "v1.0.0");
    await cust.fill("#d1000", "3");
    await cust.fill("#d500", "1");
    await cust.fill("#expected", "3000");
    await see(cust.locator("#total", { hasText: "3,500円" }));
    await see(cust.locator("#diff", { hasText: "+500円" }));
    const r = await cust.request.get(ENTRY);
    assert.match(r.headers()["content-security-policy"], /sandbox allow-scripts/);
    assert.doesNotMatch(r.headers()["content-security-policy"], /allow-same-origin/);
    const cookie = await cust.evaluate(() => { try { return document.cookie; } catch (e) { return "blocked:" + e.name; } });
    assert.match(cookie, /^blocked:/);
    // ページ内のリンク（不透明オリジンからの遷移）でも権利確認が通る
    await cust.getByRole("link", { name: "このアプリについて" }).click();
    await see(cust.getByRole("heading", { name: "このアプリについて" }));
  });

  await step("Q2 a space without a contract and an anonymous visitor cannot open the app screen (static files stay public)", async () => {
    await login(cust, "山田 花子", "さくらベーカリー（オーナー）", "/");
    await cust.goto(ENTRY);
    await see(cust.getByText("このアプリを利用する権限がありません"));
    assert.equal((await cust.request.get(ENTRY)).status(), 403);
    const anon = await anonCtx.newPage();
    assert.equal((await anon.request.get(ENTRY, { maxRedirects: 0 })).status(), 401);
    assert.equal((await anon.request.get(`${BASE}/hosted/register-close/style.css`)).status(), 200);
    assert.equal((await anon.request.get(`${BASE}/hosted/register-close/..%2F..%2Fetc%2Fpasswd`)).status(), 400);
  });

  let appId;
  await step("Q3 the provider uploads v1.1.0: build #2 succeeds and is previewable, production stays on v1.0.0", async () => {
    page = dev;
    await login(dev, "開発 次郎", "MarketStars Labs（提供会社）（オーナー）", "/developer");
    await dev.getByRole("link", { name: "レジ締めチェック" }).click();
    await dev.waitForURL(/\/developer\/apps\/[^/?#]+$/);
    appId = dev.url().split("/").pop();
    const zip = Buffer.from(await (await dev.request.get(`${BASE}/developer/hosting-sample?v=1.1.0`)).body());
    await dev.setInputFiles("#h-zip", { name: "register-close-1.1.0.zip", mimeType: "application/zip", buffer: zip });
    await dev.getByRole("button", { name: "アップロードしてビルド" }).click();
    await see(dev.getByText("ビルド #2 に成功しました"));
    const row = dev.locator('tr[data-build="2"]');
    await row.getByText("ログ").click();
    await see(row.getByText("最上位フォルダ「register-close/」を取り除きました"));
    const href = await row.getByRole("link", { name: "プレビュー" }).getAttribute("href");
    assert.match(href, /^\/hosted\/register-close\/~[a-z0-9]+\/index\.html$/);
    await dev.goto(BASE + href);
    assert.equal(await version(dev), "v1.1.0");
    // 利用者には、まだ本番（v1.0.0）が表示される。プレビューは利用者には見えない
    await login(cust, "山田 花子", "ひかり整骨院（オーナー）", "/");
    await cust.goto(ENTRY);
    assert.equal(await version(cust), "v1.0.0");
    await cust.goto(BASE + href);
    await see(cust.getByText("プレビューを表示できません"));
  });

  await step("Q4 deploy switches customers to v1.1.0; rolling back to #1 restores v1.0.0 (both audited)", async () => {
    page = dev;
    await dev.goto(`${BASE}/developer/apps/${appId}`);
    await dev.locator('tr[data-build="2"]').getByRole("button", { name: "本番に反映" }).click();
    await see(dev.getByText("本番に反映しました"));
    await see(dev.locator('tr[data-build="2"]').getByText("本番", { exact: true }));
    await cust.goto(ENTRY);
    assert.equal(await version(cust), "v1.1.0");
    await dev.locator('tr[data-build="1"]').getByRole("button", { name: "この版に戻す" }).click();
    await see(dev.locator('tr[data-build="1"]').getByText("本番", { exact: true }));
    await cust.goto(ENTRY);
    assert.equal(await version(cust), "v1.0.0");
    assert.equal(sql(`SELECT COUNT(*) FROM AuditEvent WHERE objectId='${appId}' AND action IN ('deploy','rollback')`), "2");
  });

  await step("Q5 an archive with server-side code fails the build with a readable log and never goes live", async () => {
    page = dev;
    const bad = Buffer.from(zipSync({ "index.html": strToU8("<h1>x</h1>"), "api.php": strToU8("<?php echo 1;") }));
    await dev.setInputFiles("#h-zip", { name: "bad.zip", mimeType: "application/zip", buffer: bad });
    await dev.getByLabel("ビルドに成功したら本番に自動で反映する").check();
    await dev.getByRole("button", { name: "アップロードしてビルド" }).click();
    await see(dev.getByText("ビルド #3 に失敗しました"));
    const row = dev.locator('tr[data-build="3"]');
    await row.getByText("ログ").click();
    await see(row.getByText(/api\.php：この種類のファイルは公開できません/));
    assert.equal(await row.getByRole("link", { name: "プレビュー" }).count(), 0);
    assert.equal(sql(`SELECT COUNT(*) FROM HostedFile f JOIN HostedBuild b ON b.id=f.buildId WHERE b.appId='${appId}' AND b.number=3`), "0");
    await cust.goto(ENTRY);
    assert.equal(await version(cust), "v1.0.0");
  });

  await step("Q6 auto-deploy: a successful upload with the option checked goes live immediately", async () => {
    page = dev;
    const zip = Buffer.from(await (await dev.request.get(`${BASE}/developer/hosting-sample?v=2.0.0`)).body());
    await dev.setInputFiles("#h-zip", { name: "v2.zip", mimeType: "application/zip", buffer: zip });
    await dev.getByLabel("ビルドに成功したら本番に自動で反映する").check();
    await dev.getByRole("button", { name: "アップロードしてビルド" }).click();
    await see(dev.getByText("ビルド #4 に成功し、本番に反映しました"));
    await cust.goto(ENTRY);
    assert.equal(await version(cust), "v2.0.0");
  });
} finally {
  await browser.close();
}
const failed = results.filter((r) => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
