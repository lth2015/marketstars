// デモガイド（/demo）とデモデータのリセット。node tests/e2e-p11.mjs   （AUTH_MODE=demo）
// ガイドの「開く」だけで主線シナリオ 1（探す → 無料体験 → アプリを開いて AI で文案作成）を最後まで進められることを確認する。
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const DB = process.env.MYSQL_DB ?? "marketstars";
const sql = (q) => execSync(`mysql --default-character-set=utf8mb4 ${process.env.MYSQL_ARGS ?? ""} -N ${DB} -e "${q.replace(/"/g, '\\"')}"`).toString().trim();
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(["PASS", name]); console.log("PASS", name); }
  catch (e) { results.push(["FAIL", name]); console.log("FAIL", name, e.message.split("\n")[0], page.url()); if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/fail-${name.split(" ")[0]}.png`, fullPage: true }).catch(() => {}); }
}
const see = (loc) => loc.first().waitFor({ timeout: 15000 });
const scenario = (id) => page.locator(`section#${id}`);
const open = (id, n) => scenario(id).locator("li").nth(n).getByRole("button", { name: /開く$/ }).click();

try {
  await step("G1 the guide is linked from the demo banner and lists every main-line scenario", async () => {
    await page.goto(`${BASE}/`);
    await page.getByRole("complementary", { name: "demo" }).getByRole("link", { name: "デモガイド" }).click();
    await page.waitForURL(/\/demo$/);
    await see(page.getByRole("heading", { name: "デモガイド", level: 1 }));
    assert.ok((await page.locator("section.panel h2").count()) >= 9);
    await see(page.getByText("現在：ゲスト"));
  });

  await step("G2 guest step opens the trial list; persona step signs in to the right space and page", async () => {
    await page.goto(`${BASE}/demo`);
    await open("trial", 0);
    await page.waitForURL(/\/apps\?trial=true$/);
    await page.goto(`${BASE}/demo`);
    await open("trial", 1);
    await page.waitForURL(/\/apps\/pop-writer$/);
    await see(page.locator(".cta-main", { hasText: /日間無料で試す/ }));
    await page.goto(`${BASE}/demo`);
    await see(page.getByText("現在：山田 花子 ／ さくらベーカリー（オーナー）"));
  });

  await step("G3 scenario 1 end to end from the guide: start the trial, open the app, generate copy with AI", async () => {
    await page.goto(`${BASE}/demo`);
    await open("trial", 1);
    await page.waitForURL(/\/apps\/pop-writer$/);
    await page.locator(".cta-main a", { hasText: "日間無料で試す" }).click();
    await page.getByLabel("MarketStars 利用規約に同意します").check();
    await page.getByLabel("提供会社の利用規約・プライバシーポリシーに同意します").check();
    await page.getByRole("button", { name: /日間無料で試す/ }).click();
    await page.waitForURL(/\/my\/apps\/.+done=1/);
    await page.goto(`${BASE}/demo`);
    await open("trial", 2);
    await page.waitForURL(/\/my\/apps$/);
    await page.getByRole("link", { name: "アプリを開く" }).first().click();
    await page.waitForURL(/integrations\/pop-writer$/);
    await page.fill("#product", "北海道バターのクロワッサン");
    await page.fill("#features", "サクサク、焼きたて");
    await page.getByRole("button", { name: /パターン作成/ }).click();
    await page.waitForURL(/product=/);
    await see(page.locator(".panel", { hasText: "クロワッサン" }).nth(1));
  });

  await step("G4 operator step switches identity: 運営 can open the operator KPI page", async () => {
    await page.goto(`${BASE}/demo`);
    await open("ops", 0);
    await page.waitForURL(/\/admin\/analytics$/);
    await see(page.getByRole("heading", { level: 1 }));
  });

  await step("G5 reset needs confirmation, then restores the initial data and signs everyone out", async () => {
    const trialsBefore = Number(sql("SELECT COUNT(*) FROM Subscription WHERE tenantId = 'demo-tenant-sakura' AND kind = 'trial'"));
    assert.ok(trialsBefore >= 1, "G3 should have created a trial");
    // 確認なし（ブラウザの required を外して送信）→ エラー
    await page.goto(`${BASE}/demo`);
    await page.locator('input[name="confirm"]').evaluate((el) => el.removeAttribute("required"));
    await page.getByRole("button", { name: "初期状態に戻す" }).click();
    await page.waitForURL(/error=confirm/);
    await see(page.getByRole("alert").filter({ hasText: "確認のチェック" }));
    await page.getByLabel("初期状態に戻すことを確認しました").check();
    await page.getByRole("button", { name: "初期状態に戻す" }).click();
    await page.waitForURL(/\/demo\?reset=1$/);
    await see(page.getByRole("status").filter({ hasText: "初期状態に戻しました" }));
    await see(page.getByText("現在：ゲスト"));
    assert.equal(Number(sql("SELECT COUNT(*) FROM Subscription WHERE tenantId = 'demo-tenant-sakura' AND kind = 'trial'")), 0);
    assert.equal(Number(sql("SELECT COUNT(*) FROM Session")), 0);
    const ranking = await (await fetch(`${BASE}/api/v1/ranking`)).json();
    assert.ok(ranking.items.length >= 3, "ranking is recomputed after reset");
  });

  await step("G6 the guide and reset do not exist outside demo mode (robots also excludes /demo)", async () => {
    const robots = await (await fetch(`${BASE}/robots.txt`)).text();
    assert.match(robots, /Disallow: \/demo/);
    // AUTH_MODE=oidc での 404 は e2e-oidc（O12）で確認する
  });
} finally {
  await browser.close();
}
const failed = results.filter((r) => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
