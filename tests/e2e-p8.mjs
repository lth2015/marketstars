// 无障碍（axe-core，WCAG 2.1 AA + best-practice）与 SEO 验收。node tests/e2e-p8.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const BASE = process.argv[2] ?? "http://localhost:3000";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(["PASS", name]); console.log("PASS", name); }
  catch (e) { results.push(["FAIL", name]); console.log("FAIL", name, e.message.split("\n").slice(0, 6).join(" | "), page.url()); if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/fail-${name.split(" ")[0]}.png`, fullPage: true }).catch(() => {}); }
}
async function login(userName, tenantLabel, returnTo = "/") {
  await page.goto(`${BASE}/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  const form = page.locator("form", { hasText: userName });
  await form.locator("select").selectOption({ label: tenantLabel });
  await form.getByRole("button").click();
  await page.waitForLoadState("networkidle");
}
async function axe(paths) {
  const bad = [];
  for (const p of paths) {
    await page.goto(BASE + p, { waitUntil: "networkidle" });
    await page.evaluate(axeSource);
    const r = await page.evaluate(async () => await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] }));
    for (const v of r.violations) bad.push(`${p}: ${v.id} (${v.impact}) ${v.nodes[0].target.join(" ")}`);
  }
  assert.deepEqual(bad, []);
}
try {
  await step("X1 axe: public pages have no WCAG 2.1 AA / best-practice violations", async () => {
    await axe(["/", "/apps", "/apps?trial=true&category=marketing", "/apps/pop-writer", "/ranking", "/help", "/help/getting-started", "/contact", "/auth/login"]);
  });
  await step("X2 axe: signed-in customer pages", async () => {
    await login("山田 花子", "さくらベーカリー（オーナー）", "/my/apps");
    await axe(["/my/apps", "/my/billing", "/my/notifications", "/my/agents", "/account", "/apps/sales-insight/apply"]);
  });
  await step("X3 axe: operator and developer pages", async () => {
    await login("運営 太郎", "MarketStars 運営（オーナー）", "/admin");
    await axe(["/admin", "/admin/analytics", "/admin/requests", "/admin/apps"]);
    await login("開発 次郎", "MarketStars Labs（提供会社）（オーナー）", "/developer");
    await axe(["/developer", "/developer/analytics"]);
  });
  await step("S1 robots.txt and sitemap.xml", async () => {
    const robots = await (await page.request.get(`${BASE}/robots.txt`)).text();
    assert.match(robots, /Disallow: \/admin/);
    assert.match(robots, /Disallow: \/my/);
    assert.match(robots, /Sitemap: .*\/sitemap\.xml/);
    const sm = await (await page.request.get(`${BASE}/sitemap.xml`)).text();
    assert.match(sm, /\/apps\/pop-writer<\/loc>/);
    assert.doesNotMatch(sm, /staff-training/, "drafts must not be listed");
  });
  await step("S2 detail page: canonical, OpenGraph and JSON-LD without fabricated ratings", async () => {
    await page.goto(`${BASE}/apps/sales-insight`);
    assert.match(await page.getAttribute('link[rel="canonical"]', "href"), /\/apps\/sales-insight$/);
    assert.match(await page.getAttribute('meta[property="og:title"]', "content"), /売上インサイトAI/);
    const ld = JSON.parse(await page.locator('script[type="application/ld+json"]').innerText());
    assert.equal(ld["@type"], "SoftwareApplication");
    assert.equal(ld.offers.priceCurrency, "JPY");
    assert.equal(ld.aggregateRating, undefined, "no reviews -> no rating");
    await page.goto(`${BASE}/apps/pop-writer`);
    const ld2 = JSON.parse(await page.locator('script[type="application/ld+json"]').innerText());
    assert.ok(ld2.aggregateRating?.reviewCount >= 1);
  });
} finally {
  await browser.close();
}
const failed = results.filter((r) => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
