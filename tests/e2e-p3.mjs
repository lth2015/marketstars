// AgentPay 与防篡改精算台帐的端到端验收。node tests/e2e-p3.mjs （demo 模式、重新 seed 后运行；L2 会临时篡改测试库）
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const DB = process.env.MYSQL_DB ?? "marketstars";
const sql = (q) => execSync(`mysql ${process.env.MYSQL_ARGS ?? ""} -N ${DB} -e "${q.replace(/"/g, '\\"')}"`).toString().trim();
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(["PASS", name]); console.log("PASS", name); }
  catch (e) { results.push(["FAIL", name]); console.log("FAIL", name, e.message.split("\n")[0], page.url()); }
}
async function login(userName, tenantLabel, returnTo = "/") {
  await page.goto(`${BASE}/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  const form = page.locator("form", { hasText: userName });
  await form.locator("select").selectOption({ label: tenantLabel });
  await form.getByRole("button").click();
  await page.waitForLoadState("networkidle");
}
const see = (loc) => loc.first().waitFor({ timeout: 15000 });
let KEY;
const agent = (method, path, data) => page.request.fetch(`${BASE}/api/agent/v1${path}`, { method, headers: { authorization: `Bearer ${KEY}` }, data });
const plan = async (slug, name) => (await (await page.request.get(`${BASE}/api/v1/apps/${slug}`)).json()).plans.find((p) => p.name === name);
const buy = async (slug, planName, key) => { const p = await plan(slug, planName); return agent("POST", "/subscriptions", { app_slug: slug, plan_id: p.id, expected_price_jpy: p.price_jpy, idempotency_key: key }); };

await step("A1 owner registers a card and issues an agent key (shown once)", async () => {
  await login("山田 花子", "みなと美容室（オーナー）", "/my/billing");
  await page.getByText("カードを追加").click();
  await page.fill("#cardNumber", "4242 4242 4242 4242");
  await page.fill("#exp", "12/30");
  await page.fill("#cvc", "123");
  await page.getByRole("button", { name: "カードを登録" }).click();
  await see(page.getByText("を登録しました"));
  await page.goto(`${BASE}/my/agents`);
  await page.fill("#ag-name", "テスト用エージェント");
  await page.fill("#ag-budget", "5000");
  await page.fill("#ag-pertx", "3000");
  await page.getByRole("button", { name: "キーを発行する" }).click();
  await see(page.locator("#agent-key"));
  KEY = (await page.locator("#agent-key").innerText()).trim();
  assert.match(KEY, /^msk_/);
});

await step("A2 agent reads its mandate and searches the catalog", async () => {
  const m = await (await agent("GET", "/mandate")).json();
  assert.equal(m.remaining_jpy, 5000);
  const r = await (await agent("GET", "/apps?q=カルテ")).json();
  assert.ok(r.items.some((a) => a.slug === "customer-notes"));
});

await step("A3 agent buys within limits with the saved card; retry with same key is idempotent", async () => {
  const r = await buy("customer-notes", "サロン", "agent-buy-0001");
  assert.equal(r.status(), 201, await r.text());
  const j = await r.json();
  assert.equal(j.subscription_status, "active");
  const again = await (await buy("customer-notes", "サロン", "agent-buy-0001")).json();
  assert.equal(again.transaction_id, j.transaction_id);
  assert.equal(sql(`SELECT COUNT(*) FROM Subscription WHERE tenantId='demo-tenant-minato'`), "1");
});

await step("A4 per-transaction limit and monthly budget are enforced (402)", async () => {
  const over = await buy("sales-insight", "ライト", "agent-buy-0002"); // ¥3,300 > ¥3,000
  assert.equal(over.status(), 402);
  assert.match((await over.json()).reason, /1回あたりの上限/);
  const budget = await buy("review-reply", "ベーシック", "agent-buy-0003"); // 2,200 + 2,980 > 5,000
  assert.equal(budget.status(), 402);
  assert.match((await budget.json()).reason, /今月の予算/);
  const free = await buy("menu-translator", "フリー", "agent-buy-0004");
  assert.equal(free.status(), 201);
});

await step("A5 owner sees history with reasons; revoking disables the key immediately", async () => {
  await page.goto(`${BASE}/my/agents`);
  await see(page.locator("td", { hasText: "今月の予算" }));
  await see(page.locator("td", { hasText: "¥2,200 / ¥5,000" }));
  await page.getByRole("button", { name: "取り消す" }).click();
  await page.waitForURL(/msg=/);
  assert.equal((await agent("GET", "/mandate")).status(), 401);
});

await step("L1 job appends money events to the hash chain and anchors the head", async () => {
  const r = await (await page.request.post(`${BASE}/api/internal/jobs/run`, { headers: { authorization: "Bearer local-job-token" } })).json();
  assert.ok(r.ledger.appended >= 1, JSON.stringify(r));
  assert.ok(r.ledger.anchor);
  const r2 = await (await page.request.post(`${BASE}/api/internal/jobs/run`, { headers: { authorization: "Bearer local-job-token" } })).json();
  assert.equal(r2.ledger.appended, 0);
  await login("運営 太郎", "MarketStars 運営（オーナー）", "/admin/ledger");
  await see(page.getByText("検証 OK"));
});

await step("L2 tampering with a past entry is detected", async () => {
  const orig = sql(`SELECT amountJpy FROM LedgerEntry WHERE seq=(SELECT MIN(seq) FROM LedgerEntry)`);
  sql(`UPDATE LedgerEntry SET amountJpy = amountJpy + 1 WHERE seq=(SELECT * FROM (SELECT MIN(seq) FROM LedgerEntry) t)`);
  await page.reload();
  await see(page.getByText("改ざんの可能性"));
  sql(`UPDATE LedgerEntry SET amountJpy = ${orig} WHERE seq=(SELECT * FROM (SELECT MIN(seq) FROM LedgerEntry) t)`);
  await page.reload();
  await see(page.getByText("検証 OK"));
  const exp = await page.request.get(`${BASE}/admin/ledger/export`);
  assert.equal((await exp.json()).verified.ok, true);
});

await browser.close();
const failed = results.filter((r) => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
