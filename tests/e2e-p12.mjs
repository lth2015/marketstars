// StarPay 合算請求（PRD §2「与原服务合并收费」P1）。node tests/e2e-p12.mjs   （demo モード・seed 済み）
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const JOB = process.env.JOB_TOKEN ?? "local-job-token";
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
async function login(userName, tenantLabel, returnTo = "/") {
  await page.goto(`${BASE}/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  const form = page.locator("form", { hasText: userName });
  await form.locator("select").selectOption({ label: tenantLabel });
  await form.getByRole("button").click();
  await page.waitForLoadState("networkidle");
}
const jobs = async () => (await page.request.post(`${BASE}/api/internal/jobs/run`, { headers: { authorization: `Bearer ${JOB}` } })).json();
async function apply(slug, plan, payment) {
  await page.goto(`${BASE}/apps/${slug}/apply`);
  await page.locator(".plan-card", { hasText: plan }).getByRole("link", { name: "このプランを申し込む" }).click();
  await page.waitForURL(/mode=start/);
  if (payment) await page.getByLabel(payment).check();
  await page.getByLabel("MarketStars 利用規約に同意します").check();
  await page.getByLabel("提供会社の利用規約・プライバシーポリシーに同意します").check();
}

let subId;
try {
  await step("SP1 owner links a StarPay merchant ID; malformed and unknown IDs are rejected; unlinking works", async () => {
    await login("山田 花子", "みなと美容室（オーナー）", "/my/billing");
    await see(page.getByRole("heading", { name: "StarPay との合算請求" }));
    for (const bad of ["ABC123", "SP12345679"]) {
      await page.goto(`${BASE}/my/billing`);
      await page.fill("#merchantId", bad);
      await page.getByRole("button", { name: "連携する" }).click();
      await page.waitForURL(/error=/);
      await see(page.getByText("StarPay 加盟店番号を確認できませんでした"));
    }
    await page.fill("#merchantId", "SP 1234-5678");
    await page.getByRole("button", { name: "連携する" }).click();
    await page.waitForURL(/msg=/);
    await see(page.getByText("連携中：StarPay 加盟店 5678（SP12345678）"));
    await page.getByRole("button", { name: "連携を解除" }).click();
    await page.waitForURL(/msg=/);
    await see(page.getByRole("button", { name: "連携する" }));
  });

  await step("SP2 a linked space applies with 'add to StarPay bill': starts immediately, auto-renews, first bill awaits the consolidated statement", async () => {
    await login("山田 花子", "ひかり整骨院（オーナー）", "/apps/sales-insight/apply");
    await apply("sales-insight", "ライト", /StarPay の利用料と合算（SP20240611/);
    await page.getByRole("button", { name: "この内容で申し込む" }).click();
    await page.waitForURL(/\/my\/apps\/.+done=1/);
    subId = page.url().split("/my/apps/")[1].split("?")[0];
    await see(page.getByText("利用を開始しました"));
    await see(page.getByText("StarPay 利用料と合算"));
    assert.equal(sql(`SELECT CONCAT(status, '/', paymentMode, '/', autoRenew) FROM Subscription WHERE id='${subId}'`), "active/starpay/1");
    assert.equal(sql(`SELECT CONCAT(channel, '/', status, '/', IFNULL(receiptRef,'-')) FROM BillingRecord WHERE subscriptionId='${subId}'`), "starpay/due/-");
    await page.goto(`${BASE}/my/billing`);
    await see(page.locator("tbody tr", { hasText: "売上インサイトAI" }).filter({ hasText: "合算請求待ち" }).filter({ hasText: "StarPay合算" }));
  });

  await step("SP3 a space without a StarPay link has no such option, and a forged request is rejected by the server", async () => {
    await login("山田 花子", "さくらベーカリー（オーナー）", "/apps/customer-notes/apply");
    await apply("customer-notes", "サロン");
    assert.equal(await page.getByLabel(/StarPay の利用料と合算/).count(), 0);
    await page.locator('input[name="payment"][value="card"]').evaluate((el) => { el.value = "starpay"; });
    await page.getByRole("button", { name: "この内容で申し込む" }).click();
    await see(page.getByRole("alert").filter({ hasText: "StarPay と連携していません" }));
    assert.equal(sql("SELECT COUNT(*) FROM Subscription s JOIN App a ON a.id=s.appId WHERE s.tenantId='demo-tenant-sakura' AND a.slug='customer-notes'"), "0");
  });

  await step("SP4 auto-renewal extends the period and records the next bill as due, exactly once", async () => {
    sql(`UPDATE Subscription SET currentPeriodEnd = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 12 HOUR) WHERE id='${subId}'`);
    const before = sql(`SELECT currentPeriodEnd FROM Subscription WHERE id='${subId}'`);
    const r = await jobs();
    assert.ok(r.renewed.starpay >= 1, JSON.stringify(r.renewed));
    await jobs();
    assert.equal(sql(`SELECT COUNT(*) FROM BillingRecord WHERE subscriptionId='${subId}' AND channel='starpay' AND status='due'`), "2");
    assert.notEqual(sql(`SELECT currentPeriodEnd FROM Subscription WHERE id='${subId}'`), before);
  });

  await step("SP5 operator builds the monthly statement, downloads the CSV, and confirms the StarPay collection once", async () => {
    await login("運営 太郎", "MarketStars 運営（オーナー）", "/admin/starpay");
    await see(page.getByRole("heading", { name: "StarPay 合算請求" }));
    // 「作成」後も URL は msg= のままなので、完了の表示とボタンの消滅で待つ
    while (await page.getByRole("button", { name: "合算明細を作成" }).count()) {
      const before = await page.getByRole("button", { name: "合算明細を作成" }).count();
      await page.getByRole("button", { name: "合算明細を作成" }).first().click();
      await page.waitForFunction((n) => [...document.querySelectorAll("button")].filter((b) => b.textContent === "合算明細を作成").length < n, before);
    }
    const stId = sql(`SELECT starpayStatementId FROM BillingRecord WHERE subscriptionId='${subId}' ORDER BY periodStart LIMIT 1`);
    const csv = await (await page.request.get(`${BASE}/admin/starpay/export?id=${stId}`)).text();
    assert.match(csv, /SP20240611/);
    assert.match(csv, /売上インサイトAI/);
    // CSV を出力した時点で明細が確定し、回収確認ができるようになる
    assert.equal(sql(`SELECT status FROM StarpayStatement WHERE id='${stId}'`), "exported");
    await page.reload();
    const row = page.locator("tr", { has: page.locator(`input[name="id"][value="${stId}"]`) });
    await row.locator('input[name="ref"]').fill("SPC-TEST-1");
    await row.getByRole("button", { name: "回収を確認" }).click();
    await see(page.getByText("StarPay からの回収を確認しました"));
    assert.equal(sql(`SELECT status FROM StarpayStatement WHERE id='${stId}'`), "settled");
    assert.equal(sql(`SELECT COUNT(*) FROM BillingRecord WHERE starpayStatementId='${stId}' AND status <> 'paid'`), "0");
    // 同じ明細の回収確認は 1 回だけ（ボタンはもう出ない）
    assert.equal(await page.locator(`input[name="id"][value="${stId}"]`).count(), 0);
    await login("山田 花子", "ひかり整骨院（オーナー）", "/my/billing");
    await see(page.locator("tbody tr", { hasText: "売上インサイトAI" }).filter({ hasText: "入金確認済み" }));
  });

  await step("SP6 the StarPay link cannot be removed while a contract is billed through it", async () => {
    await page.goto(`${BASE}/my/billing`);
    await page.getByRole("button", { name: "連携を解除" }).click();
    await page.waitForURL(/error=/);
    await see(page.getByText(/StarPay 合算で利用中の契約（\d+件）/));
  });
  await step("SP7 a free trial converts to the paid plan via StarPay right away (A07 path), first bill due", async () => {
    await login("山田 花子", "ひかり整骨院（オーナー）", "/my/apps");
    await page.locator(".panel", { hasText: "シフト作成AI" }).getByRole("link", { name: /契約内容/ }).click();
    await page.waitForURL(/\/my\/apps\/[^/?]+$/);
    const id = page.url().split("/my/apps/")[1];
    const card = page.locator(".plan-card", { hasText: "チーム" });
    await card.getByLabel("StarPay 利用料と合算（すぐに切り替え）").check();
    await card.getByRole("button", { name: "このプランに切り替える" }).click();
    await see(page.getByText("有料プランに切り替えました"));
    assert.equal(sql(`SELECT CONCAT(status, '/', kind, '/', paymentMode, '/', autoRenew, '/', IFNULL(scheduledPlanVersionId,'-')) FROM Subscription WHERE id='${id}'`), "active/paid/starpay/1/-");
    assert.equal(sql(`SELECT CONCAT(channel, '/', status) FROM BillingRecord WHERE subscriptionId='${id}'`), "starpay/due");
  });

  await step("SP8 a free plan upgrades via StarPay; without a link the option is absent", async () => {
    await login("山田 花子", "みなと美容室（オーナー）", "/apps/event-planner/apply");
    await page.locator(".plan-card", { hasText: "フリー" }).getByRole("link", { name: "無料で利用開始" }).click();
    await page.getByLabel("MarketStars 利用規約に同意します").check();
    await page.getByLabel("提供会社の利用規約・プライバシーポリシーに同意します").check();
    await page.getByRole("button", { name: "無料で利用開始" }).click();
    await page.waitForURL(/\/my\/apps\/.+done=1/);
    const id = page.url().split("/my/apps/")[1].split("?")[0];
    await page.goto(`${BASE}/my/apps/${id}`);
    assert.equal(await page.getByLabel("StarPay 利用料と合算（すぐに切り替え）").count(), 0);
    await page.goto(`${BASE}/my/billing`);
    await page.fill("#merchantId", "SP12345678");
    await page.getByRole("button", { name: "連携する" }).click();
    await see(page.getByText("連携中："));
    await page.goto(`${BASE}/my/apps/${id}`);
    const card = page.locator(".plan-card", { hasText: "プラス" });
    await card.getByLabel("StarPay 利用料と合算（すぐに切り替え）").check();
    await card.getByRole("button", { name: "このプランに切り替える" }).click();
    await see(page.getByText("有料プランに切り替えました"));
    assert.equal(sql(`SELECT CONCAT(kind, '/', paymentMode, '/', planNameSnapshot) FROM Subscription WHERE id='${id}'`), "paid/starpay/プラス");
  });
  await step("SP9 bills that arrive after a month's CSV is exported roll into the next month's statement; generic payment confirmation refuses StarPay bills", async () => {
    // SP7・SP8 で作られた当月開始の請求は、当月の明細がすでに CSV 出力・回収済みなので翌月の明細へ
    const settledMonth = sql("SELECT month FROM StarpayStatement WHERE status='settled' ORDER BY month LIMIT 1");
    await login("運営 太郎", "MarketStars 運営（オーナー）", "/admin/billing");
    await see(page.getByText("StarPay 合算（回収確認は「StarPay 合算請求」で）"));
    await page.goto(`${BASE}/admin/starpay`);
    const rows = await page.locator("section", { hasText: "明細に未掲載の合算請求" }).locator("tbody tr").allInnerTexts();
    assert.ok(rows.length >= 1 && rows.every((r) => !r.startsWith(settledMonth)), `unbilled rows: ${JSON.stringify(rows)}`);
    await page.getByRole("button", { name: "合算明細を作成" }).first().click();
    await see(page.getByText("の合算明細を作成しました"));
    assert.equal(sql("SELECT COUNT(*) FROM BillingRecord WHERE channel='starpay' AND status='due' AND starpayStatementId IS NULL"), "0");
    assert.ok(sql("SELECT MIN(s.month) FROM BillingRecord b JOIN StarpayStatement s ON s.id=b.starpayStatementId WHERE b.status='due'") > settledMonth);
    // 請求ごとに加盟店番号を保持している
    assert.equal(sql("SELECT COUNT(*) FROM BillingRecord WHERE channel='starpay' AND starpayMerchantId IS NULL"), "0");
  });
} finally {
  await browser.close();
}
const failed = results.filter((r) => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
