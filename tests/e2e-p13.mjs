// 決済・利用量まわりの堅牢性（独立レビューの指摘の回帰テスト）。node tests/e2e-p13.mjs   （demo モード・seed 済み）
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const DB = process.env.MYSQL_DB ?? "marketstars";
const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET ?? "local-webhook-secret";
const BASIC = "Basic " + Buffer.from(`pop-writer:${process.env.LAUNCH_CLIENT_SECRET_POP_WRITER ?? "local-pop-writer-secret"}`).toString("base64");
const sql = (q) => execSync(`mysql --default-character-set=utf8mb4 ${process.env.MYSQL_ARGS ?? ""} -N ${DB} -e "${q.replace(/"/g, '\\"')}"`).toString().trim();
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(["PASS", name]); console.log("PASS", name); }
  catch (e) { results.push(["FAIL", name]); console.log("FAIL", name, e.message.split("\n")[0], page.url()); if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/fail-${name.split(" ")[0]}.png`, fullPage: true }).catch(() => {}); }
}
const see = (loc) => loc.first().waitFor({ timeout: 15000 });
async function login(userName, tenantLabel, returnTo = "/") {
  await page.goto(`${BASE}/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  const form = page.locator("form", { hasText: userName });
  await form.locator("select").selectOption({ label: tenantLabel });
  await form.getByRole("button").click();
  await page.waitForLoadState("networkidle");
}
async function applyCard(slug, plan) {
  await page.goto(`${BASE}/apps/${slug}/apply`);
  await page.locator(".plan-card", { hasText: plan }).getByRole("link", { name: "このプランを申し込む" }).click();
  await page.waitForURL(/mode=start/);
  await page.getByLabel("MarketStars 利用規約に同意します").check();
  await page.getByLabel("提供会社の利用規約・プライバシーポリシーに同意します").check();
  await page.getByRole("button", { name: "この内容で申し込む" }).click();
  await page.waitForURL(/\/pay\//);
  return page.url().split("/pay/")[1].split("?")[0];
}
const webhook = (body) => {
  const raw = JSON.stringify(body);
  return page.request.post(`${BASE}/api/v1/payments/webhook`, { headers: { "content-type": "application/json", "x-payment-signature": crypto.createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex") }, data: raw });
};
const gateway = (tenant, requestId, maxTokens = 50) => page.request.post(`${BASE}/api/v1/models/messages`, { headers: { authorization: BASIC }, data: { tenant_id: tenant, request_id: requestId, max_tokens: maxTokens, messages: [{ role: "user", content: "商品：テスト\n特徴：おいしい" }] } });

try {
  await step("H1 a card payment for a withdrawn application is cancelled before charging (no charge, no contract)", async () => {
    await login("山田 花子", "みなと美容室（オーナー）", "/apps/customer-notes/apply");
    const intentId = await applyCard("customer-notes", "サロン");
    const subId = sql(`SELECT subscriptionId FROM PaymentIntent WHERE id='${intentId}'`);
    await page.goto(`${BASE}/my/apps/${subId}`);
    await page.getByRole("button", { name: "お申し込みを取り下げる" }).click();
    await page.waitForURL(/msg=/);
    assert.equal(sql(`SELECT status FROM PaymentIntent WHERE id='${intentId}'`), "canceled");
    await page.goto(`${BASE}/pay/${intentId}`);
    await see(page.getByText("このお支払いは取り消されています"));
    assert.equal(sql(`SELECT COUNT(*) FROM BillingRecord WHERE subscriptionId='${subId}'`), "0");
  });

  await step("H2 a second upgrade request cancels the first payment, so the first can no longer be paid", async () => {
    await page.goto(`${BASE}/apps/event-planner/apply`);
    await page.locator(".plan-card", { hasText: "フリー" }).getByRole("link", { name: "無料で利用開始" }).click();
    await page.getByLabel("MarketStars 利用規約に同意します").check();
    await page.getByLabel("提供会社の利用規約・プライバシーポリシーに同意します").check();
    await page.getByRole("button", { name: "無料で利用開始" }).click();
    await page.waitForURL(/\/my\/apps\/.+done=1/);
    const subId = page.url().split("/my/apps/")[1].split("?")[0];
    const upgrade = async () => {
      await page.goto(`${BASE}/my/apps/${subId}`);
      await page.locator(".plan-card", { hasText: "プラス" }).getByRole("button", { name: "このプランに切り替える" }).click();
      await page.waitForURL(/\/pay\//);
      return page.url().split("/pay/")[1].split("?")[0];
    };
    const a = await upgrade();
    const b = await upgrade();
    assert.notEqual(a, b);
    assert.equal(sql(`SELECT status FROM PaymentIntent WHERE id='${a}'`), "canceled");
    assert.equal(sql(`SELECT status FROM PaymentIntent WHERE id='${b}'`), "requires_payment");
  });

  await step("H3 a charge that cannot be applied any more is recorded as charged_unsettled (not lost, not retried)", async () => {
    // 取り下げ済みの申込に対して、決済サービスから課金成功の通知が来た場合
    const intentId = sql("SELECT pi.id FROM PaymentIntent pi JOIN Subscription s ON s.id=pi.subscriptionId WHERE s.status='withdrawn' ORDER BY pi.createdAt DESC LIMIT 1");
    const r = await webhook({ type: "charge.succeeded", intent_id: intentId, charge_id: `ch_test_${Date.now()}` });
    assert.equal(r.status(), 409);
    assert.equal(sql(`SELECT status FROM PaymentIntent WHERE id='${intentId}'`), "charged_unsettled");
    assert.ok(sql(`SELECT providerChargeId FROM PaymentIntent WHERE id='${intentId}'`).startsWith("ch_test_"));
    assert.equal(sql(`SELECT COUNT(*) FROM AuditEvent WHERE objectId='${intentId}' AND action='charged_unsettled'`), "1");
    await login("運営 太郎", "MarketStars 運営（オーナー）", "/admin/billing");
    await see(page.getByText(/要対応：課金済み・未反映の決済（\d+ 件）/));
  });

  // 以下は AI POPメーカー（トークン従量）を有料で使う空間が必要：さくらベーカリーで体験を開始
  let tenant, subId;
  await step("H4 concurrent gateway calls cannot exceed the monthly usage cap", async () => {
    await login("山田 花子", "さくらベーカリー（オーナー）", "/apps/pop-writer");
    await page.locator(".cta-main a", { hasText: "日間無料で試す" }).click();
    await page.getByLabel("MarketStars 利用規約に同意します").check();
    await page.getByLabel("提供会社の利用規約・プライバシーポリシーに同意します").check();
    await page.getByRole("button", { name: /日間無料で試す/ }).click();
    await page.waitForURL(/\/my\/apps\/.+done=1/);
    subId = page.url().split("/my/apps/")[1].split("?")[0];
    tenant = sql(`SELECT tenantId FROM Subscription WHERE id='${subId}'`);
    sql(`UPDATE Subscription SET usageCapJpy = 1 WHERE id='${subId}'`);
    const rs = await Promise.all(Array.from({ length: 12 }, (_, i) => gateway(tenant, `h4-${Date.now()}-${i}`)));
    const codes = rs.map((r) => r.status());
    assert.ok(codes.every((c) => c === 200 || c === 429), JSON.stringify(codes));
    assert.ok(codes.includes(429), "the cap must stop some requests");
    const spent = Number(sql(`SELECT COALESCE(SUM(costMilliJpy),0) FROM UsageEvent WHERE subscriptionId='${subId}'`));
    assert.ok(spent <= 1000, `spent ${spent} milli-yen > cap ¥1`);
    assert.equal(sql(`SELECT COUNT(*) FROM UsageEvent WHERE subscriptionId='${subId}' AND model LIKE '%(reserved)'`), "0");
  });

  await step("H5 the same request_id sent concurrently runs the model once and is billed once", async () => {
    sql(`UPDATE Subscription SET usageCapJpy = NULL WHERE id='${subId}'`);
    const id = `h5-${Date.now()}`;
    const rs = await Promise.all(Array.from({ length: 4 }, () => gateway(tenant, id)));
    const codes = rs.map((r) => r.status()).sort();
    assert.deepEqual(codes, [200, 409, 409, 409]);
    assert.equal(sql(`SELECT COUNT(*) FROM UsageEvent WHERE requestId='${id}'`), "1");
  });
} finally {
  await browser.close();
}
const failed = results.filter((r) => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
