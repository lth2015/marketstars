// セキュリティの回帰テスト（独立レビューの指摘）。node tests/e2e-p14.mjs   （demo モード・seed 済み）
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const DB = process.env.MYSQL_DB ?? "marketstars";
const sql = (q) => execSync(`mysql --default-character-set=utf8mb4 ${process.env.MYSQL_ARGS ?? ""} -N ${DB} -e "${q.replace(/"/g, '\\"')}"`).toString().trim();
const browser = await chromium.launch();
const devCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const opsCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
let page = await devCtx.newPage();
const opsPage = await opsCtx.newPage();
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

try {
  await step("X1 returnTo with tab/newline tricks cannot redirect off-site (/locale, demo login)", async () => {
    for (const rt of ["/%09/evil.example", "/%0a/evil.example", "/%0d//evil.example", "//evil.example", "/%5Cevil.example"]) {
      const r = await page.request.get(`${BASE}/locale?set=ja&returnTo=${rt}`, { maxRedirects: 0 });
      const loc = r.headers().location ?? "";
      assert.ok(r.status() >= 300 && r.status() < 400, `status ${r.status()}`);
      assert.ok(loc.startsWith(BASE + "/"), `${rt} -> ${loc}`);
      assert.ok(!/evil\.example/.test(new URL(loc).host), `${rt} -> ${loc}`);
    }
  });

  let appUrl;
  await step("X2 a developer cannot publish an unreviewed draft by withdrawing after the operator opened the submission", async () => {
    await login(page, "開発 次郎", "ミライAI合同会社（オーナー）", "/developer");
    await page.getByLabel(/開発者規約/).check();
    await page.getByRole("button", { name: "登録する" }).click();
    await page.waitForURL(/msg=/);
    await page.getByRole("link", { name: "新しいアプリ" }).click();
    await page.fill("#name", "審査すり抜けテスト");
    await page.fill("#slug", "race-" + Date.now().toString(36));
    await page.getByRole("button", { name: "下書きを作成" }).click();
    await page.waitForURL(/developer\/apps\/.+msg=/);
    appUrl = page.url().split("?")[0];
    await page.fill("#f-tagline", "審査済みの内容です。");
    await page.fill("#f-iconUrl", "https://example.com/icon.png");
    await page.fill("#f-problem", "審査で確認した課題の説明です。");
    await page.fill("#f-launchUrl", "https://example.com/app");
    // X4: javascript: の利用規約リンクは提出できない
    await page.fill("#f-termsUrl", "javascript:alert(1)");
    await page.fill("#f-privacyUrl", "https://example.com/privacy");
    await page.locator("label", { hasText: "店舗運営" }).locator("input").first().check();
    await page.fill('input[name="plan_0_key"]', "standard");
    await page.fill('input[name="plan_0_name"]', "スタンダード");
    await page.fill('input[name="plan_0_priceJpy"]', "1500");
    await page.getByRole("button", { name: "下書きを保存" }).click();
    await page.waitForURL(/msg=/);
    await page.getByRole("button", { name: "審査に提出" }).click();
    await see(page.getByText(/利用規約・プライバシーポリシーのリンク（https）/));
    await page.fill("#f-termsUrl", "https://example.com/terms");
    await page.getByRole("button", { name: "下書きを保存" }).click();
    await page.waitForURL(/msg=/);
    await page.getByRole("button", { name: "審査に提出" }).click();
    await page.waitForURL(/msg=/);
    await see(page.getByText("審査中"));

    // 運営が提出を開いた後で、開発者が取り下げて内容を書き換える
    await login(opsPage, "運営 太郎", "MarketStars 運営（オーナー）", "/admin/submissions");
    await see(opsPage.locator(".panel", { hasText: "審査すり抜けテスト" }));
    await page.goto(appUrl);
    await page.getByRole("button", { name: "提出を取り下げる" }).click();
    await page.waitForURL(/msg=/);
    await page.fill("#f-tagline", "審査を通っていない内容");
    await page.getByRole("button", { name: "下書きを保存" }).click();
    await page.waitForURL(/msg=/);

    await opsPage.locator(".panel", { hasText: "審査すり抜けテスト" }).getByRole("button", { name: "承認して公開" }).click();
    await see(opsPage.getByText("提出内容が変わっています"));
    const slug = appUrl.split("/").pop();
    assert.equal(sql(`SELECT status FROM App WHERE id='${slug}'`), "draft");
  });

  await step("X3 the provider's own space cannot review its own app", async () => {
    // MarketStars Labs（AI POPメーカーの提供会社）の空間で無料プランを開始しても、レビューは書けない
    await login(page, "開発 次郎", "MarketStars Labs（提供会社）（オーナー）", "/apps/pop-writer/apply");
    await page.locator(".plan-card", { hasText: "フリー" }).getByRole("link", { name: "無料で利用開始" }).click();
    await page.getByLabel("MarketStars 利用規約に同意します").check();
    await page.getByLabel("提供会社の利用規約・プライバシーポリシーに同意します").check();
    await page.getByRole("button", { name: "無料で利用開始" }).click();
    await page.waitForURL(/\/my\/apps\/.+done=1/);
    await page.goto(`${BASE}/apps/pop-writer#reviews`);
    await see(page.getByText("利用したことのある方が投稿できます"));
    assert.equal(await page.getByRole("button", { name: /レビューを(投稿|更新)/ }).count(), 0);
  });
} finally {
  await browser.close();
}
const failed = results.filter((r) => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
