// 性能验收：200 个已发布应用、50 并发，列表和详情 API 的 P95 < 500ms（不含外部 SSO 和图片加载）。
// 用法：node tests/perf.mjs [baseUrl] [秒数]   （先 npx tsx scripts/seed-perf.ts，服务以 production build 启动）
import { createRequire } from "node:module";
const autocannon = createRequire(import.meta.url)("autocannon");
const BASE = process.argv[2] ?? "http://localhost:3000";
const DURATION = Number(process.argv[3] ?? 20);
const targets = [
  ["一覧 API（既定 30件）", "/api/v1/apps"],
  ["一覧 API（検索+絞り込み+価格順 50件）", "/api/v1/apps?q=%E3%82%A2%E3%83%97%E3%83%AA&category=marketing&trial=true&sort=price&per=50"],
  ["詳細 API", "/api/v1/apps/pop-writer"],
  ["一覧ページ（SSR HTML）", "/apps"],
  ["詳細ページ（SSR HTML）", "/apps/pop-writer"],
];
const rows = [];
for (const [name, path] of targets) {
  await autocannon({ url: BASE + path, connections: 10, duration: 3 }); // warm-up
  const r = await autocannon({ url: BASE + path, connections: 50, duration: DURATION });
  // autocannon 不提供 P95，用更严格的 P97.5 判定（P97.5 < 500ms ⇒ P95 < 500ms）
  const p975 = r.latency.p97_5;
  rows.push({ name, rps: Math.round(r.requests.average), "p50(ms)": r.latency.p50, "p97.5(ms)": p975, "p99(ms)": r.latency.p99, errors: r.errors + r.non2xx, pass: p975 < 500 && r.errors + r.non2xx === 0 });
}
console.table(rows);
process.exit(rows.every((r) => r.pass) ? 0 : 1);
