// A03 验收：推荐、新着、排行及展示价格按规定计算，不展示虚假统计。
// 每一项都用 SQL 按 PRD 的规则独立计算期望值，再与 API / 页面比对。node tests/e2e-p10.mjs
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const JOB = process.env.JOB_TOKEN ?? "local-job-token";
const DB = process.env.MYSQL_DB ?? "marketstars";
const sql = (q) => execSync(`mysql --default-character-set=utf8mb4 ${process.env.MYSQL_ARGS ?? ""} -N ${DB} -e "${q.replace(/"/g, '\\"')}"`).toString().trim();
const rowsOf = (out) => (out ? out.split("\n").map((l) => l.split("\t")) : []);
const api = async (path) => (await fetch(BASE + path)).json();
// 强制重新计算排行（任务每 55 分钟最多执行一次）
async function recomputeRanking() {
  sql("DELETE FROM JobLock WHERE name = 'ranking'");
  const r = await fetch(`${BASE}/api/internal/jobs/run`, { method: "POST", headers: { Authorization: `Bearer ${JOB}` } });
  assert.equal(r.status, 200);
}
// 规则：近 30 天开始利用（free / paid，不含试用与内部测试），状态为已开通过的，每个空间每款应用只计一次
const EXPECTED_RANKING = `
  SELECT a.slug, COUNT(DISTINCT s.tenantId) c, a.firstPublishedAt
  FROM Subscription s JOIN App a ON a.id = s.appId
  WHERE s.startedAt >= NOW(3) - INTERVAL 30 DAY AND s.kind IN ('free','paid') AND s.internalTest = 0
    AND s.status IN ('active','cancel_scheduled','suspended','expired','canceled')
    AND a.status = 'published' AND a.internalTest = 0
  GROUP BY a.id, a.slug, a.firstPublishedAt ORDER BY c DESC, a.firstPublishedAt ASC, a.id ASC`;

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(["PASS", name]); console.log("PASS", name); }
  catch (e) { results.push(["FAIL", name]); console.log("FAIL", name, e.message.split("\n")[0], page.url()); if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/fail-${name.split(" ")[0]}.png`, fullPage: true }).catch(() => {}); }
}
const see = (loc) => loc.first().waitFor({ timeout: 15000 });

try {
  await step("R1 ranking API equals the rule computed from the database (order and counts)", async () => {
    await recomputeRanking();
    const expected = rowsOf(sql(EXPECTED_RANKING)).map(([slug, c]) => ({ slug, count: Number(c) }));
    const got = (await api("/api/v1/ranking")).items.map((i) => ({ slug: i.slug, count: i.count }));
    assert.ok(expected.length >= 3, "seed should produce ranking data");
    assert.deepEqual(got, expected);
  });

  await step("R2 trials, internal tests, withdrawn and repeat activations of the same space do not inflate the ranking", async () => {
    const slug = "sales-insight";
    const before = (await api("/api/v1/ranking")).items.find((i) => i.slug === slug)?.count ?? 0;
    const [appId, planId] = rowsOf(sql(`SELECT a.id, p.id FROM App a JOIN PlanVersion p ON p.appId = a.id AND p.current = 1 WHERE a.slug = '${slug}' LIMIT 1`))[0];
    const ins = (id, tenant, kind, status, internal = 0) => sql(`INSERT INTO Subscription (id, tenantId, tenantName, appId, planVersionId, kind, status, priceJpySnapshot, planNameSnapshot, createdBy, startedAt, internalTest, updatedAt)
      VALUES ('${id}', '${tenant}', 'A03 test', '${appId}', '${planId}', '${kind}', '${status}', 0, 'A03', 'a03', NOW(3) - INTERVAL 1 DAY, ${internal}, NOW(3))`);
    ins("a03-trial", "a03-tenant-trial", "trial", "trialing");
    ins("a03-internal", "a03-tenant-internal", "paid", "active", 1);
    ins("a03-withdrawn", "a03-tenant-withdrawn", "paid", "withdrawn");
    ins("a03-new-1", "a03-tenant-real", "paid", "canceled"); // 同一空间：先解约
    ins("a03-new-2", "a03-tenant-real", "paid", "active"); //   再开通，只算一次
    await recomputeRanking();
    const after = (await api("/api/v1/ranking")).items.find((i) => i.slug === slug)?.count ?? 0;
    assert.equal(after, before + 1);
  });

  await step("R3 ranking page shows the same order, the counting rule and when it was computed", async () => {
    const items = (await api("/api/v1/ranking")).items;
    await page.goto(`${BASE}/ranking`);
    await see(page.getByText("直近30日間に新たに利用を開始した空間"));
    await see(page.getByText(/最終集計：/));
    const shown = await page.locator(".rank-row").evaluateAll((rows) => rows.map((r) => ({ name: r.querySelector("a")?.textContent ?? "", rank: Number(r.querySelector(".rank-no")?.textContent) })));
    assert.deepEqual(shown.map((r) => r.name), items.map((i) => i.name));
    assert.deepEqual(shown.map((r) => r.rank), items.map((i) => i.rank));
    // 每行显示的空间数与 API 一致
    for (const [n, i] of items.slice(0, 3).entries()) assert.match(await page.locator(".rank-row").nth(n).locator(".rank-count").innerText(), new RegExp(`${i.count} 空間`));
  });

  await step("R4 NEW follows the first publication date (30 days) and is not refreshed by edits", async () => {
    sql("UPDATE App SET firstPublishedAt = NOW(3) - INTERVAL 31 DAY, updatedAt = NOW(3) WHERE slug = 'pop-writer'");
    await page.goto(`${BASE}/apps/pop-writer`);
    await see(page.getByRole("heading", { level: 1 }));
    assert.equal(await page.locator(".detail-head .tag-new").count(), 0);
    sql("UPDATE App SET firstPublishedAt = NOW(3) - INTERVAL 29 DAY WHERE slug = 'pop-writer'");
    await page.reload();
    await see(page.locator(".detail-head .tag-new"));
  });

  await step("R5 recommended order and displayed minimum prices follow the operator weight and the current plans", async () => {
    const expected = rowsOf(sql("SELECT slug FROM App WHERE status = 'published' AND internalTest = 0 ORDER BY recommendWeight DESC, firstPublishedAt DESC, id ASC")).map((r) => r[0]);
    const list = await api("/api/v1/apps?per=50");
    assert.deepEqual(list.items.map((i) => i.slug), expected);
    // 最低月额：免费方案 = 0，需咨询的方案不计入；没有可计价方案时为 null
    const mins = Object.fromEntries(rowsOf(sql(`SELECT a.slug, MIN(CASE WHEN p.priceType = 'free' THEN 0 WHEN p.priceType = 'monthly' THEN p.priceJpy END)
      FROM App a JOIN PlanVersion p ON p.appId = a.id AND p.current = 1 WHERE a.status = 'published' AND a.internalTest = 0 GROUP BY a.slug`)).map(([s, v]) => [s, v === "NULL" ? null : Number(v)]));
    for (const i of list.items) assert.equal(i.min_monthly_price_jpy, mins[i.slug], `min price of ${i.slug}`);
    // 卡片上的价格文字与最低月额一致
    const paid = list.items.find((i) => i.min_monthly_price_jpy > 0 && !i.has_free_plan);
    await page.goto(`${BASE}/apps?per=50`);
    const card = page.locator(".app-card, article", { hasText: paid.name }).first();
    await see(card);
    assert.match(await card.innerText(), new RegExp(`¥${paid.min_monthly_price_jpy.toLocaleString("en-US")}／月（税込）`));
  });

  await step("R6 no fabricated statistics: apps without reviews show no stars or rating, ranking without data says so", async () => {
    const [slug] = rowsOf(sql("SELECT slug FROM App WHERE status = 'published' AND internalTest = 0 AND ratingCount = 0 LIMIT 1"))[0];
    await page.goto(`${BASE}/apps/${slug}`);
    await see(page.getByText("まだレビューはありません"));
    assert.equal(await page.locator(".detail-head").getByText("★").count(), 0);
    const ld = await page.locator('script[type="application/ld+json"]').first().textContent();
    assert.ok(!ld.includes("aggregateRating"), "JSON-LD must not include a rating without reviews");
    // 没有利用数据的类别：显示“集计中”，不显示虚构的名次
    const cat = rowsOf(sql(`SELECT c.slug FROM Category c WHERE NOT EXISTS (
      SELECT 1 FROM RankingEntry r JOIN _AppToCategory ac ON ac.A = r.appId WHERE ac.B = c.id) LIMIT 1`))[0]?.[0];
    if (cat) {
      await page.goto(`${BASE}/ranking?category=${cat}`);
      await see(page.getByText("このカテゴリのランキングは集計中です"));
    }
  });
} finally {
  await browser.close();
}
const failed = results.filter((r) => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
