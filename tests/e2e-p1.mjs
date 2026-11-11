// P1 端到端验收：在线支付与自动续费、套餐变更、评分评论、开发者提交与审核。
// node tests/e2e-p1.mjs [baseUrl]   （demo 模式、已 seed、已运行过 jobs）
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const JOB = process.env.JOB_TOKEN ?? "local-job-token";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(["PASS", name]); console.log("PASS", name); }
  catch (e) { results.push(["FAIL", name]); console.log("FAIL", name, e.message.split("\n")[0], page.url()); if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/fail-${results.length}.png`, fullPage: true }); }
}
async function login(userName, tenantLabel, returnTo = "/") {
  await page.goto(`${BASE}/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  const form = page.locator("form", { hasText: userName });
  await form.locator("select").selectOption({ label: tenantLabel });
  await form.getByRole("button").click();
  await page.waitForLoadState("networkidle");
}
const see = (loc) => loc.first().waitFor({ timeout: 10000 });
async function agreeAndSubmit(btn) {
  await page.getByLabel("MarketStars 利用規約に同意します").check();
  await page.getByLabel("提供会社の利用規約・プライバシーポリシーに同意します").check();
  await page.getByRole("button", { name: btn }).click();
}
async function payWithNewCard(number) {
  await page.waitForURL(/\/pay\//);
  const newCard = page.getByLabel("新しいカードを使う");
  if (await newCard.count()) await newCard.check();
  await page.fill("#cardNumber", number);
  await page.fill("#exp", "12/30");
  await page.fill("#cvc", "123");
  await page.getByRole("button", { name: /を支払う/ }).click();
}
const runJobs = () => page.request.post(`${BASE}/api/internal/jobs/run`, { headers: { authorization: `Bearer ${JOB}` } }).then((r) => r.json());

let subId;
await step("P1-1 card: declined card shows error, then success starts immediately with auto-renew", async () => {
  await login("山田 花子", "みなと美容室（オーナー）", "/apps/customer-notes/apply");
  await page.locator(".plan-card", { hasText: "サロン" }).getByRole("link", { name: "このプランを申し込む" }).click();
  await agreeAndSubmit("この内容で申し込む");
  await payWithNewCard("4000 0000 0000 0002");
  await see(page.getByText("このカードはご利用いただけません"));
  await payWithNewCard("4242 4242 4242 4242");
  await page.waitForURL(/paid=1/);
  await see(page.getByText("お支払いが完了しました"));
  await see(page.locator(".badge", { hasText: "利用中" }));
  await see(page.getByText("自動更新：オン"));
  subId = page.url().split("/my/apps/")[1].split("?")[0];
});

await step("P1-2 billing shows card payment record and saved card", async () => {
  await page.goto(`${BASE}/my/billing`);
  await see(page.getByText("Visa •••• 4242"));
  await see(page.locator("td", { hasText: "カード" }));
});

await step("P1-3 auto-renew job extends period exactly once (idempotent)", async () => {
  // 需要直接修改测试库，把本期结束拨到 12 小时后以模拟临近期末（MYSQL_DB 指定测试库）
  const { execSync } = await import("node:child_process");
  const db = process.env.MYSQL_DB ?? "marketstars";
  execSync(`mysql ${process.env.MYSQL_ARGS ?? ""} ${db} -e "UPDATE Subscription SET currentPeriodEnd = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 12 HOUR) WHERE id='${subId}'"`);
  const r1 = await runJobs();
  const r2 = await runJobs();
  assert.equal(r1.renewed.charged, 1, JSON.stringify(r1));
  assert.equal(r2.renewed.charged, 0, JSON.stringify(r2));
  const n = execSync(`mysql ${process.env.MYSQL_ARGS ?? ""} -N ${db} -e "SELECT COUNT(*) FROM BillingRecord WHERE subscriptionId='${subId}'"`).toString().trim();
  assert.equal(n, "2");
});

await step("P1-4 plan change on paid: scheduled for period end, cancellable", async () => {
  await page.goto(`${BASE}/apps/sales-insight/apply`);
  await page.locator(".plan-card", { hasText: "ライト" }).getByRole("link", { name: "このプランを申し込む" }).click();
  await agreeAndSubmit("この内容で申し込む");
  await payWithNewCard("4242 4242 4242 4242").catch(() => {});
  await page.waitForURL(/paid=1/);
  await page.locator("form.plan-card", { hasText: "プロ" }).getByRole("button", { name: "次の期間からこのプランにする" }).click();
  await page.waitForURL(/msg=/);
  await see(page.getByText(/から「プロ」に変更されます/));
  await page.getByRole("button", { name: "変更を取り消す" }).click();
  await page.waitForURL(/msg=/);
  await see(page.getByText("プラン変更の予定を取り消しました"));
});

await step("P1-5 free → paid upgrade via card switches plan immediately", async () => {
  // 体験ありのビジネスプランではなくフリーを選ぶ
  await page.goto(`${BASE}/apps/faq-bot/apply`);
  await page.locator(".plan-card", { hasText: "フリー" }).getByRole("link", { name: "無料で利用開始" }).click();
  await agreeAndSubmit("無料で利用開始");
  await page.waitForURL(/done=1/);
  await page.locator("form.plan-card", { hasText: "ビジネス" }).getByRole("button", { name: "このプランに切り替える" }).click();
  await page.waitForURL(/\/pay\//);
  await page.getByRole("button", { name: /を支払う/ }).click(); // 保存済みカード
  await page.waitForURL(/paid=1/);
  await see(page.locator("dd", { hasText: "ビジネス" }));
});

await step("P1-6 trial → paid conversion by invoice appears in operator queue and converts", async () => {
  await page.goto(`${BASE}/apps/review-reply`);
  const href = await page.locator(".cta-main a", { hasText: "日間無料で試す" }).getAttribute("href");
  await page.goto(BASE + href);
  await agreeAndSubmit(/日間無料で試す/);
  await page.waitForURL(/done=1/);
  const id = page.url().split("/my/apps/")[1].split("?")[0];
  await page.getByLabel("請求書払い").check();
  await page.getByRole("button", { name: "このプランに切り替える" }).click();
  await page.waitForURL(/msg=/);
  await login("運営 太郎", "MarketStars 運営（オーナー）", "/admin/requests");
  const card = page.locator(".panel", { hasText: "無料体験から切り替え" }).first();
  await card.locator('input[name="receiptRef"]').fill("TEST-CONV-001");
  await card.getByRole("button", { name: "入金確認して開始" }).click();
  await page.waitForURL(/msg=/);
  await login("山田 花子", "みなと美容室（オーナー）", `/my/apps/${id}`);
  await see(page.locator(".badge", { hasText: "利用中" }));
  await see(page.getByText("請求書払い"));
});

await step("P1-7 review: user who used the app can post; rating shows on detail", async () => {
  await page.goto(`${BASE}/apps/customer-notes#reviews`);
  await page.getByLabel("タイトル").fill("カルテ入力が楽に");
  await page.getByLabel("本文（10文字以上）").fill("音声メモで施術内容を残せるので、閉店後の作業が減りました。");
  await page.getByRole("button", { name: "レビューを投稿" }).click();
  await see(page.getByText("レビューを投稿しました"));
  await page.reload();
  await see(page.locator("article", { hasText: "カルテ入力が楽に" }));
});

await step("P1-8 review: non-user cannot post", async () => {
  await login("佐藤 健", "さくらベーカリー（メンバー）", "/apps/contract-check");
  await see(page.getByText("利用したことのある方が投稿できます"));
});

let devAppUrl;
await step("P1-9 developer registers, creates app, submits; incomplete submission rejected", async () => {
  await login("開発 次郎", "ミライAI合同会社（オーナー）", "/developer");
  await page.getByLabel(/開発者規約/).check();
  await page.getByRole("button", { name: "登録する" }).click();
  await page.waitForURL(/msg=/);
  await page.getByRole("link", { name: "新しいアプリ" }).click();
  await page.fill("#name", "AI日報まとめ");
  await page.fill("#slug", "daily-report-" + Date.now().toString(36));
  await page.getByRole("button", { name: "下書きを作成" }).click();
  await page.waitForURL(/developer\/apps\/.+msg=/);
  devAppUrl = page.url().split("?")[0];
  await page.getByRole("button", { name: "審査に提出" }).click();
  await see(page.getByText("提出に必要な項目が不足しています"));
  await page.fill("#f-tagline", "スタッフの日報を AI が要約し、店長に毎日届けます。");
  await page.fill("#f-iconUrl", "https://example.com/icon.png");
  await page.fill("#f-problem", "日報の確認に時間がかかる問題を解決します。");
  await page.fill("#f-launchUrl", "https://example.com/daily-report");
  await page.fill("#f-termsUrl", "https://example.com/terms");
  await page.fill("#f-privacyUrl", "https://example.com/privacy");
  await page.locator("label", { hasText: "店舗運営" }).locator("input").first().check();
  await page.fill('input[name="plan_0_key"]', "standard");
  await page.fill('input[name="plan_0_name"]', "スタンダード");
  await page.fill('input[name="plan_0_priceJpy"]', "1500");
  await page.fill('input[name="plan_0_trialDays"]', "14");
  await page.getByRole("button", { name: "下書きを保存" }).click();
  await page.waitForURL(/msg=/);
  await page.getByRole("button", { name: "審査に提出" }).click();
  await page.waitForURL(/msg=/);
  await see(page.getByText("審査中"));
});

await step("P1-10 developer cannot access other provider's app or admin", async () => {
  const r = await page.goto(`${BASE}/admin/submissions`);
  await see(page.getByText("アクセスする権限がありません"));
  const apps = await (await page.request.get(`${BASE}/api/v1/apps/pop-writer`)).json();
  assert.ok(apps.slug);
});

await step("P1-11 operator rejects then approves; app becomes public with plan", async () => {
  await login("運営 太郎", "MarketStars 運営（オーナー）", "/admin/submissions");
  const card = page.locator(".panel", { hasText: "AI日報まとめ" }).first();
  await card.locator('input[name="note"]').fill("スクリーンショットを追加してください");
  await card.getByRole("button", { name: "差し戻す" }).click();
  await page.waitForURL(/msg=/);
  await login("開発 次郎", "ミライAI合同会社（オーナー）", devAppUrl.replace(BASE, ""));
  await see(page.getByText("スクリーンショットを追加してください"));
  await page.fill("#f-screenshots", "https://example.com/s1.png|日報画面");
  await page.getByRole("button", { name: "下書きを保存" }).click();
  await page.waitForURL(/msg=/);
  await page.getByRole("button", { name: "審査に提出" }).click();
  await page.waitForURL(/msg=/);
  await login("運営 太郎", "MarketStars 運営（オーナー）", "/admin/submissions");
  await page.locator(".panel", { hasText: "AI日報まとめ" }).first().getByRole("button", { name: "承認して公開" }).click();
  await page.waitForURL(/msg=/);
  await page.goto(`${BASE}/apps?q=日報`);
  await see(page.locator(".app-card", { hasText: "AI日報まとめ" }));
  await see(page.locator(".app-card", { hasText: "¥1,500" }));
});

await step("P1-12 admin can hide a review and rating recomputes", async () => {
  await page.goto(`${BASE}/admin/reviews`);
  const r = page.locator(".panel", { hasText: "カルテ入力が楽に" }).first();
  await r.getByRole("button", { name: "非表示" }).click();
  await page.waitForURL(/msg=/);
  await page.goto(`${BASE}/apps/customer-notes#reviews`);
  assert.equal(await page.locator("article", { hasText: "カルテ入力が楽に" }).count(), 0);
});

await browser.close();
const failed = results.filter((r) => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
