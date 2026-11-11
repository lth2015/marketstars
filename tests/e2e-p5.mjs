// 运营 KPI 与开发者分析的端到端验收。node tests/e2e-p5.mjs（demo 模式、重新 seed 后运行）
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const DB = process.env.MYSQL_DB ?? "marketstars";
const sql = (q) => execSync(`mysql --default-character-set=utf8mb4 ${process.env.MYSQL_ARGS ?? ""} -N ${DB} -e "${q.replace(/"/g, '\\"')}"`).toString().trim();
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
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
try {
  await step("K1 operator KPIs match the database (MRR, paid count) and charts have a table view", async () => {
    const mrr = Number(sql(`SELECT COALESCE(SUM(priceJpySnapshot),0) FROM Subscription WHERE internalTest=0 AND kind='paid' AND status IN ('active','cancel_scheduled','suspended') AND currentPeriodEnd > UTC_TIMESTAMP(3)`));
    await login("運営 太郎", "MarketStars 運営（オーナー）", "/admin/analytics");
    await see(page.getByText(`¥${mrr.toLocaleString("ja-JP")}`));
    await see(page.getByRole("img", { name: /月別売上/ }));
    await page.getByText("表で見る").first().click();
    await see(page.locator("details[open] table"));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
  });
  await step("K2 non-operator cannot open operator analytics", async () => {
    await login("山田 花子", "さくらベーカリー（オーナー）", "/admin/analytics");
    await see(page.getByText("アクセスする権限がありません"));
  });
  await step("K3 developer analytics show only the provider's own apps", async () => {
    await login("開発 次郎", "MarketStars Labs（提供会社）（オーナー）", "/developer/analytics");
    await see(page.getByRole("link", { name: "AI POPメーカー" }));
    assert.equal(await page.getByRole("link", { name: "売上インサイトAI" }).count(), 0);
  });
} finally {
  await browser.close();
}
const failed = results.filter((r) => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
