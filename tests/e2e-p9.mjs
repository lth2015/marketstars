// 账号注销申请验收：前提检查阻止申请、确认勾选、运营处理流程、MarketStars 侧不删除数据、取下申请。node tests/e2e-p9.mjs
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
async function login(userName, tenantLabel, returnTo = "/") {
  await page.goto(`${BASE}/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  const form = page.locator("form", { hasText: userName });
  await form.locator("select").selectOption({ label: tenantLabel });
  await form.getByRole("button").click();
  await page.waitForLoadState("networkidle");
}
const see = (loc) => loc.first().waitFor({ timeout: 15000 });
let subId;
try {
  await step("D1 a live paid subscription blocks the request", async () => {
    await login("山田 花子", "さくらベーカリー（オーナー）", "/apps/customer-notes/apply");
    await page.locator(".plan-card", { hasText: "サロン" }).getByRole("link", { name: "このプランを申し込む" }).click();
    await page.getByLabel("MarketStars 利用規約に同意します").check();
    await page.getByLabel("提供会社の利用規約・プライバシーポリシーに同意します").check();
    await page.getByRole("button", { name: "この内容で申し込む" }).click();
    await page.waitForURL(/\/pay\//);
    await page.fill("#cardNumber", "4242 4242 4242 4242");
    await page.fill("#exp", "12/30");
    await page.fill("#cvc", "123");
    await page.getByRole("button", { name: /を支払う/ }).click();
    await page.waitForURL(/paid=1/);
    subId = page.url().split("/my/apps/")[1].split("?")[0];
    await page.goto(`${BASE}/account/deletion`);
    await see(page.locator("li", { hasText: "利用中の有料契約" }).getByText("（対応が必要）"));
    assert.equal(await page.getByRole("button", { name: "アカウント削除を申請する" }).isDisabled(), true);
  });

  await step("D2 after scheduling cancellation, confirmation is required, then the request is accepted (not deleted)", async () => {
    await page.goto(`${BASE}/my/apps/${subId}`);
    await page.getByRole("button", { name: "期間終了時に解約する" }).click();
    await page.waitForURL(/msg=/);
    await page.goto(`${BASE}/account/deletion`);
    await see(page.locator("li", { hasText: "利用中の有料契約" }).getByText("（問題なし）"));
    await page.getByRole("button", { name: "アカウント削除を申請する" }).click();
    await see(page.getByText("チェックを入れてください"));
    await page.getByLabel(/すべての接続アプリにログインできなくなる/).check();
    await page.getByRole("button", { name: "アカウント削除を申請する" }).click();
    await see(page.getByText("アカウントはまだ削除されていません"));
    await see(page.getByText("受付済み"));
    assert.equal(await page.getByRole("button", { name: "アカウント削除を申請する" }).count(), 0, "no second submission while open");
  });

  await step("D3 operator reviews, must record the SSO ticket, then closes; MarketStars keeps the records", async () => {
    await login("運営 太郎", "MarketStars 運営（オーナー）", "/admin/deletions");
    await page.getByRole("button", { name: "確認を開始" }).click();
    await page.waitForURL(/msg=/);
    await page.locator('input[name="ssoTicketRef"]').fill("SSO-DEL-0001");
    await page.getByRole("button", { name: "SSO に引き継ぐ" }).click();
    await page.waitForURL(/msg=/);
    await page.getByRole("button", { name: "完了にする" }).click();
    await page.waitForURL(/msg=/);
    assert.equal(sql(`SELECT status FROM DeletionRequest ORDER BY createdAt DESC LIMIT 1`), "closed");
    assert.equal(sql(`SELECT COUNT(*) FROM Subscription WHERE id='${subId}'`), "1");
    assert.ok(Number(sql(`SELECT COUNT(*) FROM BillingRecord WHERE subscriptionId='${subId}'`)) >= 1);
    await login("山田 花子", "さくらベーカリー（オーナー）", "/account/deletion");
    await see(page.getByText("SSO-DEL-0001"));
  });

  await step("D4 a new request can be withdrawn by the user", async () => {
    await page.getByLabel(/すべての接続アプリにログインできなくなる/).check();
    await page.getByRole("button", { name: "アカウント削除を申請する" }).click();
    await see(page.getByText("アカウントはまだ削除されていません"));
    await page.getByRole("button", { name: "申請を取り下げる" }).click();
    await see(page.getByText("申請を取り下げました"));
  });
} finally {
  await browser.close();
}
const failed = results.filter((r) => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
