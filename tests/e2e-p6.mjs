// 安全加固验收：CSP nonce、请求 ID、按 IP 限流（XFF 伪造无效）、咨询表单限流、安全头。
// 服务需以 TRUSTED_PROXY_HOPS=1 启动。node tests/e2e-p6.mjs
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(["PASS", name]); console.log("PASS", name); }
  catch (e) { results.push(["FAIL", name]); console.log("FAIL", name, e.message.split("\n")[0], page.url()); if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/fail-${name.split(" ")[0]}.png`, fullPage: true }).catch(() => {}); }
}
const see = (loc) => loc.first().waitFor({ timeout: 15000 });
// 每次运行用不同的「客户端 IP」，避免与上次运行的计数窗口相互影响
const ip = `198.51.100.${Math.floor(Math.random() * 200) + 20}`;
const xff = (client) => ({ "x-forwarded-for": `${client}, 10.0.0.1` });

try {
  await step("S1 CSP with per-request nonce; every script carries it; no violations; app stays interactive", async () => {
    const violations = [];
    page.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) violations.push(m.text()); });
    const r1 = await page.goto(`${BASE}/apps`);
    const csp = r1.headers()["content-security-policy"];
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    assert.ok(nonce && csp.includes("'strict-dynamic'") && csp.includes("frame-ancestors 'none'") && csp.includes("object-src 'none'"));
    const scripts = await page.$$eval("script", (els) => els.map((e) => e.nonce || e.getAttribute("nonce") || ""));
    assert.ok(scripts.length > 0 && scripts.every((n) => n === nonce), `scripts without nonce: ${scripts.filter((n) => n !== nonce).length}`);
    const r2 = await page.request.get(`${BASE}/apps`);
    assert.notEqual(/'nonce-([^']+)'/.exec(r2.headers()["content-security-policy"])?.[1], nonce, "nonce must change per request");
    await page.selectOption('select[aria-label="並び順"]', "new");
    await page.waitForURL(/sort=new/);
    assert.deepEqual(violations, []);
  });

  await step("S2 request ID is generated, or echoed when provided", async () => {
    const a = await page.request.get(`${BASE}/api/healthz`);
    assert.match(a.headers()["x-request-id"] ?? "", /^[0-9a-f-]{36}$/);
    const b = await page.request.get(`${BASE}/api/healthz`, { headers: { "x-request-id": "req-e2e-12345" } });
    assert.equal(b.headers()["x-request-id"], "req-e2e-12345");
  });

  await step("S3 security headers", async () => {
    const h = (await page.request.get(`${BASE}/`)).headers();
    assert.equal(h["x-frame-options"], "DENY");
    assert.equal(h["x-content-type-options"], "nosniff");
    assert.equal(h["cross-origin-opener-policy"], "same-origin");
    assert.match(h["permissions-policy"], /camera=\(\)/);
    assert.equal(h["strict-transport-security"], undefined, "no HSTS on http");
  });

  await step("S4 login start is limited per client IP (30/min); spoofed XFF prefixes do not escape the bucket", async () => {
    let last;
    for (let i = 0; i < 30; i++) {
      last = await page.request.get(`${BASE}/auth/start?returnTo=/`, { headers: xff(ip), maxRedirects: 0 });
      assert.notEqual(last.status(), 429, `request ${i + 1} limited too early`);
    }
    const limited = await page.request.get(`${BASE}/auth/start?returnTo=/`, { headers: xff(ip), maxRedirects: 0 });
    assert.equal(limited.status(), 429);
    assert.ok(Number(limited.headers()["retry-after"]) > 0);
    const spoofed = await page.request.get(`${BASE}/auth/start?returnTo=/`, { headers: { "x-forwarded-for": `9.9.9.9, ${ip}, 10.0.0.1` }, maxRedirects: 0 });
    assert.equal(spoofed.status(), 429, "client-supplied prefix must not change the bucket");
    const other = await page.request.get(`${BASE}/auth/start?returnTo=/`, { headers: xff("203.0.113.250"), maxRedirects: 0 });
    assert.notEqual(other.status(), 429);
  });

  await step("S5 contact form is limited per client IP (5 per 10 min)", async () => {
    await ctx.setExtraHTTPHeaders(xff(`${ip.replace(/\.\d+$/, "")}.${(Number(ip.split(".")[3]) + 1) % 250}`));
    for (let i = 0; i < 6; i++) {
      await page.goto(`${BASE}/contact`);
      await page.fill("#name", "テスト");
      await page.fill("#email", "t@example.test");
      await page.fill("#message", `限流テスト ${i}`);
      await page.getByRole("button", { name: "送信する" }).click();
      if (i < 5) await see(page.getByText("受付番号"));
      else await see(page.getByText("送信回数が多すぎます"));
    }
    await ctx.setExtraHTTPHeaders({});
  });
} finally {
  await browser.close();
}
const failed = results.filter((r) => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
