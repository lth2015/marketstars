// 多语言基础验收：语言切换（Cookie）、<html lang>、导航 / 主按钮 / 状态徽章的英文，切回日语。node tests/e2e-p7.mjs
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(["PASS", name]); console.log("PASS", name); }
  catch (e) { results.push(["FAIL", name]); console.log("FAIL", name, e.message.split("\n")[0], page.url()); if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/fail-${name.split(" ")[0]}.png`, fullPage: true }).catch(() => {}); }
}
const see = (loc) => loc.first().waitFor({ timeout: 15000 });
try {
  await step("I1 switching to English keeps the current page and localizes the chrome", async () => {
    await page.goto(`${BASE}/apps?sort=new`);
    assert.equal(await page.getAttribute("html", "lang"), "ja");
    await page.getByRole("link", { name: /English/ }).click();
    await page.waitForURL(/\/apps\?sort=new$/);
    assert.equal(await page.getAttribute("html", "lang"), "en");
    await see(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "All apps" }));
    await see(page.getByPlaceholder("Search apps or what you want to solve"));
  });
  await step("I2 detail CTA is localized for guests", async () => {
    await page.goto(`${BASE}/apps/pop-writer`);
    await see(page.locator(".cta-main", { hasText: "Log in to use" }));
  });
  await step("I3 status badges are localized for signed-in users", async () => {
    await page.goto(`${BASE}/auth/login?returnTo=/apps/pop-writer`);
    const form = page.locator("form", { hasText: "山田 花子" });
    await form.locator("select").selectOption({ label: "さくらベーカリー（オーナー）" });
    await form.getByRole("button").click();
    await page.waitForURL(/\/apps\/pop-writer$/);
    await see(page.locator(".cta-main", { hasText: /Try free for \d+ days/ }));
    const href = await page.locator(".cta-main a").getAttribute("href");
    await page.goto(BASE + href);
    await page.getByLabel("MarketStars 利用規約に同意します").check();
    await page.getByLabel("提供会社の利用規約・プライバシーポリシーに同意します").check();
    await page.getByRole("button", { name: /日間無料で試す/ }).click();
    await page.waitForURL(/done=1/);
    await see(page.locator(".badge", { hasText: "Free trial" }));
  });
  await step("I4 switching back to Japanese", async () => {
    await page.getByRole("link", { name: /日本語/ }).click();
    await page.waitForURL(/\/my\/apps\//);
    assert.equal(await page.getAttribute("html", "lang"), "ja");
    await see(page.locator(".badge", { hasText: "無料体験中" }));
  });
} finally {
  await browser.close();
}
const failed = results.filter((r) => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
