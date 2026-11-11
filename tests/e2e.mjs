// 端到端验收脚本（demo 模式）：node tests/e2e.mjs [baseUrl]
// 覆盖：浏览/筛选、试用、启动接入应用、付费申请→运营确认、非 owner、租户隔离、运营权限。
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import assert from "node:assert/strict";
import fs from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS_DIR;
const browser = await chromium.launch();
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(["PASS", name]); console.log("PASS", name); }
  catch (e) { results.push(["FAIL", name]); console.log("FAIL", name, e.message); }
}
async function login(page, userName, tenantLabel, returnTo = "/") {
  await page.goto(`${BASE}/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  const form = page.locator("form", { hasText: userName });
  await form.locator("select").selectOption({ label: tenantLabel });
  await form.getByRole("button").click();
  await page.waitForLoadState("networkidle");
}

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

await step("A01 home → category filter → sort → detail, URL keeps state", async () => {
  await page.goto(BASE);
  await page.getByRole("link", { name: "マーケティング・コンテンツ" }).first().click();
  await page.waitForURL(/category=marketing/);
  await page.selectOption('select[aria-label="並び順"]', "price");
  await page.waitForURL(/sort=price/);
  await page.reload();
  assert.equal(await page.locator('select[aria-label="並び順"]').inputValue(), "price");
  assert.ok(await page.locator(".chip", { hasText: "マーケティング" }).count());
  await page.locator(".app-card h3 a").first().click();
  await page.waitForURL(/\/apps\/[a-z-]+$/);
  await page.goBack();
  await page.waitForURL(/sort=price/);
});

await step("A02 combined filters and empty state", async () => {
  await page.goto(`${BASE}/apps?category=analytics&industry=beauty`);
  await page.getByText("条件に合うアプリが見つかりませんでした").first().waitFor({ timeout: 10000 });
  await page.goto(`${BASE}/apps?trial=true&industry=restaurant`);
  const n = await page.locator(".app-card").count();
  assert.ok(n > 0);
});

await step("A04 guest CTA asks to login and returns to the app", async () => {
  await page.goto(`${BASE}/apps/pop-writer`);
  await page.locator(".cta-main").getByRole("link", { name: "ログインして利用する" }).click();
  await login(page, "山田 花子", "さくらベーカリー（オーナー）", "/apps/pop-writer");
  assert.match(page.url(), /\/apps\/pop-writer$/);
});

await step("A06/A07 start trial; no auto charge; cannot trial twice", async () => {
  await page.locator(".cta-main a", { hasText: "日間無料で試す" }).click();
  await page.getByText("自動で課金されることはありません").first().waitFor({ timeout: 10000 });
  await page.getByLabel("MarketStars 利用規約に同意します").check();
  await page.getByLabel("提供会社の利用規約・プライバシーポリシーに同意します").check();
  await page.getByRole("button", { name: /日間無料で試す/ }).click();
  await page.waitForURL(/\/my\/apps\/.+done=1/);
  await page.getByText("無料体験中").first().first().waitFor({ timeout: 10000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/contract-1440.png`, fullPage: true });
});

let trialSubUrl;
await step("A12 open integrated app via one-time launch code and generate copy", async () => {
  trialSubUrl = page.url().split("?")[0];
  await page.getByRole("link", { name: "アプリを開く" }).first().click();
  await page.waitForURL(/integrations\/pop-writer$/);
  await page.fill("#product", "北海道バターのクロワッサン");
  await page.fill("#features", "サクサク、焼きたて");
  await page.getByRole("button", { name: /パターン作成/ }).click();
  await page.waitForURL(/product=/);
  await page.locator(".panel", { hasText: "クロワッサン" }).nth(1).waitFor({ timeout: 10000 });
  const r = await page.request.post(`${BASE}/api/v1/launch/exchange`, { data: { code: "forged" }, headers: { authorization: "Basic " + Buffer.from("pop-writer:wrong").toString("base64") } });
  assert.equal(r.status(), 401);
});

let paidSubId;
await step("A08 paid application stays pending", async () => {
  await page.goto(`${BASE}/apps/sales-insight/apply`);
  await page.locator(".plan-card", { hasText: "プロ" }).getByRole("link", { name: "このプランを申し込む" }).click();
  await page.getByLabel("MarketStars 利用規約に同意します").check();
  await page.getByLabel("提供会社の利用規約・プライバシーポリシーに同意します").check();
  await page.getByRole("button", { name: "この内容で申し込む" }).click();
  await page.waitForURL(/\/my\/apps\/.+done=1/);
  await page.getByText("まだお支払いは完了していません").first().waitFor({ timeout: 10000 });
  paidSubId = page.url().split("/my/apps/")[1].split("?")[0];
  await page.goto(`${BASE}/apps/sales-insight`);
  await page.locator(".cta-main", { hasText: "申込状況を確認" }).first().waitFor({ timeout: 10000 });
});

await step("A05 tenant isolation: other space cannot read the contract", async () => {
  await login(page, "山田 花子", "みなと美容室（オーナー）", "/my/apps");
  const r = await page.goto(`${BASE}/my/apps/${paidSubId}`);
  assert.equal(r.status(), 404);
  const api = await page.request.get(`${BASE}/api/v1/my/subscriptions`);
  const j = await api.json();
  assert.ok(!j.items.some((x) => x.id === paidSubId));
});

await step("A13 non-operator owner cannot use admin", async () => {
  await page.goto(`${BASE}/admin/requests`);
  await page.getByText("アクセスする権限がありません").first().waitFor({ timeout: 10000 });
});

await step("Member (non-owner) sees 'ask admin' and cannot apply", async () => {
  await login(page, "佐藤 健", "さくらベーカリー（メンバー）", "/apps/review-reply");
  await page.locator(".cta-main", { hasText: "管理者に申し込みを依頼" }).first().waitFor({ timeout: 10000 });
});

await step("A08/A10 operator confirms payment once; duplicate receipt does not extend", async () => {
  await login(page, "運営 太郎", "MarketStars 運営（オーナー）", "/admin/requests");
  const card = page.locator(".panel", { hasText: "売上インサイトAI" }).first();
  await card.locator('input[name="receiptRef"]').fill("TEST-RCPT-0001");
  await card.locator('input[name="amountJpy"]').fill("100");
  await card.getByRole("button", { name: "入金確認して開始" }).click();
  await page.getByText("一致しません").first().waitFor({ timeout: 10000 });
  const card2 = page.locator(".panel", { hasText: "売上インサイトAI" }).first();
  await card2.locator('input[name="receiptRef"]').fill("TEST-RCPT-0001");
  await card2.getByRole("button", { name: "入金確認して開始" }).click();
  await page.waitForURL(/msg=/);
  await page.goto(`${BASE}/admin/subscriptions?q=さくら`);
  const row = page.locator("tr", { hasText: "売上インサイトAI" }).first();
  await row.getByText("利用中").first().waitFor({ timeout: 10000 });
  const before = await row.locator("td").nth(3).innerText();
  await row.locator('input[name="receiptRef"]').fill("TEST-RCPT-0001");
  await row.getByRole("button", { name: "入金確認して延長" }).click();
  await page.waitForURL(/msg=/);
  await page.getByText("重複処理は行っていません").first().waitFor({ timeout: 10000 });
  const after = await page.locator("tr", { hasText: "売上インサイトAI" }).first().locator("td").nth(3).innerText();
  assert.equal(before, after);
});

await step("A09 owner cancels at period end and undoes", async () => {
  await login(page, "山田 花子", "さくらベーカリー（オーナー）", `/my/apps/${paidSubId}`);
  await page.getByRole("button", { name: "期間終了時に解約する" }).click();
  await page.waitForURL(/msg=/);
  await page.getByText("解約予定").first().first().waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "解約を取り消す" }).click();
  await page.waitForURL(/msg=/);
  await page.locator(".badge", { hasText: "利用中" }).first().waitFor({ timeout: 10000 });
});

await step("API: tenant comes from session; duplicate trial rejected (409)", async () => {
  const me = await (await page.request.get(`${BASE}/api/v1/me`)).json();
  const app = await (await page.request.get(`${BASE}/api/v1/apps/pop-writer`)).json();
  const plan = app.plans.find((p) => p.trial_days > 0);
  const r = await page.request.post(`${BASE}/api/v1/my/subscriptions`, { headers: { "x-csrf-token": me.csrf_token, "idempotency-key": "e2e-key-" + Date.now() }, data: { app_slug: "pop-writer", plan_id: plan.id, expected_price_jpy: plan.price_jpy, mode: "trial", agreed: true, tenant_id: "demo-tenant-minato" } });
  assert.equal(r.status(), 409);
  const noCsrf = await page.request.post(`${BASE}/api/v1/my/subscriptions`, { headers: { "idempotency-key": "x".repeat(10) }, data: {} });
  assert.equal(noCsrf.status(), 403);
});

await step("A14 layouts have no horizontal overflow (1440/1024/768/390)", async () => {
  for (const w of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width: w, height: 900 });
    for (const path of ["/", "/apps", "/apps/pop-writer", "/my/apps", "/apps/sales-insight/apply"]) {
      await page.goto(BASE + path, { waitUntil: "networkidle" });
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(over <= 1, `${path} overflows by ${over}px at ${w}`);
      if (SHOTS && (w === 1440 || w === 390)) await page.screenshot({ path: `${SHOTS}/${path === "/" ? "home" : path.replace(/\//g, "_").slice(1)}-${w}.png`, fullPage: w === 1440 });
    }
  }
});

await browser.close();
const failed = results.filter((r) => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (SHOTS) fs.writeFileSync(`${SHOTS}/results.txt`, results.map((r) => r.join(" ")).join("\n"));
process.exit(failed.length ? 1 : 0);
