// 后续功能端到端验收：统一模型网关与 Token 按量计费、月度按量账单、供应商自动分账、图片上传。
// node tests/e2e-p2.mjs   （demo 模式、重新 seed 后运行；会直接修改测试库的时间字段以模拟跨月）
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const DB = process.env.MYSQL_DB ?? "marketstars";
const SECRET = process.env.LAUNCH_CLIENT_SECRET_POP_WRITER ?? "local-pop-writer-secret";
const BASIC = "Basic " + Buffer.from(`pop-writer:${SECRET}`).toString("base64");
const sql = (q) => execSync(`mysql -N ${DB} -e "${q.replace(/"/g, '\\"')}"`).toString().trim();
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
const gateway = (body, auth = BASIC) => page.request.post(`${BASE}/api/v1/models/messages`, { headers: { authorization: auth }, data: body });
const runJobs = () => page.request.post(`${BASE}/api/internal/jobs/run`, { headers: { authorization: "Bearer local-job-token" } }).then((r) => r.json());

await step("G1 gateway rejects bad client and non-entitled tenant", async () => {
  const bad = await gateway({ tenant_id: "x", request_id: "req-00000001", messages: [{ role: "user", content: "hi" }] }, "Basic " + Buffer.from("pop-writer:nope").toString("base64"));
  assert.equal(bad.status(), 401);
  const no = await gateway({ tenant_id: "demo-tenant-sakura", request_id: "req-00000002", messages: [{ role: "user", content: "hi" }] });
  assert.equal(no.status(), 403);
});

let subId;
await step("G2 trial → open app → AI proposal via SDK, usage metered on contract page", async () => {
  await login("山田 花子", "さくらベーカリー（オーナー）", "/apps/pop-writer");
  const href = await page.locator(".cta-main a", { hasText: "日間無料で試す" }).getAttribute("href");
  await page.goto(BASE + href);
  await page.getByLabel("MarketStars 利用規約に同意します").check();
  await page.getByLabel("提供会社の利用規約・プライバシーポリシーに同意します").check();
  await page.getByRole("button", { name: /日間無料で試す/ }).click();
  await page.waitForURL(/done=1/);
  subId = page.url().split("/my/apps/")[1].split("?")[0];
  await page.getByRole("link", { name: "アプリを開く" }).first().click();
  await page.waitForURL(/integrations\/pop-writer$/);
  await page.fill("#product", "栗のモンブラン");
  await page.fill("#features", "秋限定、和栗");
  await page.getByLabel(/AI モデルでも提案する/).check();
  await page.getByRole("button", { name: /パターン作成/ }).click();
  await see(page.getByText(/AI 提案（\d+ tokens/));
  await page.goto(`${BASE}/my/apps/${subId}`);
  await see(page.getByText("AI モデル利用量"));
  await see(page.locator("dd", { hasText: /^1$/ }));
});

await step("G3 same request_id is billed once (409 on retry)", async () => {
  const body = { tenant_id: "demo-tenant-sakura", request_id: "e2e-idem-0001", messages: [{ role: "user", content: "テスト" }] };
  assert.equal((await gateway(body)).status(), 200);
  assert.equal((await gateway(body)).status(), 409);
  assert.equal(sql(`SELECT COUNT(*) FROM UsageEvent WHERE requestId='e2e-idem-0001'`), "1");
});

await step("G4 monthly usage cap blocks further calls (429)", async () => {
  await page.goto(`${BASE}/my/apps/${subId}`);
  await page.fill("#cap", "0");
  await page.getByRole("button", { name: "保存" }).first().click();
  await page.waitForURL(/msg=/);
  const r = await gateway({ tenant_id: "demo-tenant-sakura", request_id: "e2e-cap-0001", messages: [{ role: "user", content: "テスト" }] });
  assert.equal(r.status(), 429);
  await page.fill("#cap", "");
  await page.getByRole("button", { name: "保存" }).first().click();
  await page.waitForURL(/msg=/);
});

await step("G5 month-end job bills last month usage once; operator confirms invoice", async () => {
  // 把用量移到上个月以模拟月末
  sql(`UPDATE UsageEvent SET createdAt = DATE_SUB(createdAt, INTERVAL 40 DAY) WHERE subscriptionId='${subId}'`);
  const r1 = await runJobs();
  const r2 = await runJobs();
  assert.equal(r1.usage.created, 1, JSON.stringify(r1));
  assert.equal(r2.usage.created, 0);
  await page.goto(`${BASE}/my/billing`);
  await see(page.locator("td", { hasText: "AI従量" }));
  await login("運営 太郎", "MarketStars 運営（オーナー）", "/admin/billing");
  const row = page.locator("tr", { hasText: "AI従量" }).first();
  await row.locator('input[name="receiptRef"]').fill("E2E-USAGE-001");
  await row.getByRole("button", { name: "入金確認" }).click();
  await page.waitForURL(/msg=/);
  await see(page.getByText("入金を確認しました"));
});

await step("G6 payouts: operator generates last month statement with revenue share and marks paid", async () => {
  sql(`UPDATE BillingRecord SET paidAt = DATE_SUB(paidAt, INTERVAL 40 DAY) WHERE receiptRef='E2E-USAGE-001'`);
  const amount = Number(sql(`SELECT amountJpy FROM BillingRecord WHERE receiptRef='E2E-USAGE-001'`));
  await page.goto(`${BASE}/admin/payouts`);
  await page.getByRole("button", { name: "精算書を作成" }).click();
  await page.waitForURL(/msg=/);
  const row = page.locator("tr", { hasText: "MarketStars Labs" }).first();
  await see(row);
  const payout = Number(sql(`SELECT payoutJpy FROM PayoutStatement ps JOIN Provider p ON p.id=ps.providerId WHERE p.name='MarketStars Labs'`));
  assert.equal(payout, Math.floor(amount * 0.7));
  await row.locator('input[name="reference"]').fill("FURIKOMI-001");
  await row.getByRole("button", { name: "支払済み" }).click();
  await page.waitForURL(/msg=/);
  await see(page.getByText("FURIKOMI-001"));
  // 重复生成不重算
  await page.getByRole("button", { name: "精算書を作成" }).click();
  await page.waitForURL(/msg=/);
  assert.equal(sql(`SELECT COUNT(*) FROM PayoutStatement`), "1");
});

await step("G7 developer uploads icon/screenshot (PNG ok, disguised SVG rejected) and sees earnings page", async () => {
  await login("開発 次郎", "ミライAI合同会社（オーナー）", "/developer");
  await page.getByLabel(/開発者規約/).check();
  await page.getByRole("button", { name: "登録する" }).click();
  await page.waitForURL(/msg=/);
  await page.getByRole("link", { name: "新しいアプリ" }).click();
  await page.fill("#name", "画像テスト");
  await page.fill("#slug", "img-test-" + Date.now().toString(36));
  await page.getByRole("button", { name: "下書きを作成" }).click();
  await page.waitForURL(/msg=/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ms-up-"));
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  fs.writeFileSync(path.join(dir, "icon.png"), png);
  fs.writeFileSync(path.join(dir, "evil.png"), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  await page.setInputFiles("#f-iconFile", path.join(dir, "icon.png"));
  await page.setInputFiles("#f-screenshotFiles", path.join(dir, "icon.png"));
  await page.getByRole("button", { name: "下書きを保存" }).click();
  await see(page.getByText("下書きを保存しました"));
  const iconUrl = await page.inputValue("#f-iconUrl");
  assert.match(iconUrl, /^\/api\/assets\//);
  const img = await page.request.get(BASE + iconUrl);
  assert.equal(img.headers()["content-type"], "image/png");
  assert.equal(img.headers()["x-content-type-options"], "nosniff");
  assert.match(await page.inputValue("#f-screenshots"), /\/api\/assets\/.+\|icon/);
  await page.setInputFiles("#f-iconFile", path.join(dir, "evil.png"));
  await page.getByRole("button", { name: "下書きを保存" }).click();
  await see(page.getByText("PNG / JPEG / WebP のみ"));
  await page.goto(`${BASE}/developer/earnings`);
  await page.fill("#pa", "テスト銀行 本店 普通 1234567 ミライエーアイ");
  await page.getByRole("button", { name: "保存" }).click();
  await see(page.getByText("振込先を保存しました"));
});

await browser.close();
const failed = results.filter((r) => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
