// 事件 / 通知 / 邮件 / 提供商 Webhook 的端到端验收。node tests/e2e-p4.mjs（demo 模式、WEBHOOK_ALLOW_PRIVATE=true、重新 seed 后运行）
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import http from "node:http";
import crypto from "node:crypto";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const DB = process.env.MYSQL_DB ?? "marketstars";
const sql = (q) => execSync(`mysql --default-character-set=utf8mb4 ${process.env.MYSQL_ARGS ?? ""} -N ${DB} -e "${q.replace(/"/g, '\\"')}"`).toString().trim();

// 接收端：记录请求，mode=fail 时返回 500
const received = [];
let mode = "ok";
const recv = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => { received.push({ headers: req.headers, body }); res.statusCode = mode === "ok" ? 200 : 500; res.end(mode); });
}).listen(4599, "127.0.0.1");
const verify = (secret, r) => {
  const m = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(r.headers["x-marketstars-signature"] ?? "");
  return !!m && crypto.createHmac("sha256", secret).update(`${m[1]}.${r.body}`).digest("hex") === m[2];
};

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
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
const events = () => page.request.post(`${BASE}/api/internal/jobs/run?scope=events`, { headers: { authorization: "Bearer local-job-token" } }).then((r) => r.json());
const ofType = (t) => received.filter((r) => JSON.parse(r.body).type === t);
let secret, popAppId;

try {
  await step("W1 provider registers a webhook; test ping is delivered with a valid signature", async () => {
    popAppId = sql(`SELECT id FROM App WHERE slug='pop-writer'`);
    await login("開発 次郎", "MarketStars Labs（提供会社）（オーナー）", `/developer/apps/${popAppId}`);
    await page.fill("#wh-url", "http://127.0.0.1:4599/hook");
    await page.getByRole("button", { name: "Webhook を追加" }).click();
    await see(page.getByText("Webhook を登録しました"));
    await page.getByText("署名シークレットを表示").click();
    secret = (await page.locator("#webhooks details code").first().innerText()).trim();
    assert.match(secret, /^whsec_/);
    await page.getByRole("button", { name: "テスト送信" }).click();
    await see(page.getByText("テスト送信に成功しました"));
    const ping = ofType("webhook.ping")[0];
    assert.ok(ping && verify(secret, ping));
    assert.equal(verify("whsec_wrong", ping), false);
  });

  let subId;
  await step("W2 tenant starts a trial → in-app notification and signed subscription webhook", async () => {
    await login("山田 花子", "さくらベーカリー（オーナー）", "/apps/pop-writer");
    const href = await page.locator(".cta-main a", { hasText: "日間無料で試す" }).getAttribute("href");
    await page.goto(BASE + href);
    await page.getByLabel("MarketStars 利用規約に同意します").check();
    await page.getByLabel("提供会社の利用規約・プライバシーポリシーに同意します").check();
    await page.getByRole("button", { name: /日間無料で試す/ }).click();
    await page.waitForURL(/done=1/);
    subId = page.url().split("/my/apps/")[1].split("?")[0];
    await events();
    const hook = ofType("subscription.trial_started")[0];
    assert.ok(hook && verify(secret, hook), "trial_started webhook");
    const body = JSON.parse(hook.body);
    assert.equal(body.data.subscription.id, subId);
    assert.equal(body.data.subscription.tenant_id, "demo-tenant-sakura");
    assert.equal(hook.headers["x-marketstars-event"], "subscription.trial_started");
    await page.goto(`${BASE}/my/apps`);
    await see(page.locator(".bell-count"));
    await page.locator(".bell").click();
    await see(page.getByText("AI POPメーカー の無料体験を開始しました"));
    await page.getByRole("button", { name: "すべて既読にする" }).click();
    await page.getByRole("button", { name: "すべて既読にする" }).waitFor({ state: "detached", timeout: 15000 });
    await page.locator(".bell-count").waitFor({ state: "detached", timeout: 15000 });
  });

  await step("W3 failed delivery is retried with backoff and can be redelivered by the provider", async () => {
    mode = "fail";
    await page.goto(`${BASE}/my/apps/${subId}`);
    await page.getByRole("button", { name: "無料体験を今すぐ終了する" }).click();
    await page.waitForURL(/msg=/);
    await events();
    assert.equal(sql(`SELECT d.status FROM WebhookDelivery d JOIN DomainEvent e ON e.id=d.eventId WHERE e.type='subscription.trial_ended'`), "failed");
    const next = sql(`SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(3), d.nextAttemptAt) FROM WebhookDelivery d JOIN DomainEvent e ON e.id=d.eventId WHERE e.type='subscription.trial_ended'`);
    assert.ok(Number(next) > 30, `backoff ${next}s`);
    mode = "ok";
    await login("開発 次郎", "MarketStars Labs（提供会社）（オーナー）", `/developer/apps/${popAppId}`);
    await see(page.getByText(/失敗：HTTP 500/));
    await page.getByRole("button", { name: "再送" }).first().click();
    await see(page.getByText("再送に成功しました"));
    assert.ok(ofType("subscription.trial_ended").length >= 2);
  });

  await step("W4 owner email contact receives activation mail (outbox, log transport)", async () => {
    await login("山田 花子", "さくらベーカリー（オーナー）", "/apps/menu-translator/apply");
    await page.locator(".plan-card", { hasText: "フリー" }).getByRole("link", { name: "無料で利用開始" }).click();
    await page.getByLabel("MarketStars 利用規約に同意します").check();
    await page.getByLabel("提供会社の利用規約・プライバシーポリシーに同意します").check();
    await page.getByRole("button", { name: "無料で利用開始" }).click();
    await page.waitForURL(/done=1/);
    await events();
    assert.equal(sql(`SELECT status FROM EmailOutbox WHERE EmailOutbox.to='hanako@example.test' AND subject LIKE '%メニュー多言語化AI の利用を開始%'`), "sent");
    await login("運営 太郎", "MarketStars 運営（オーナー）", "/admin/mailbox");
    await see(page.getByText("[MarketStars] メニュー多言語化AI の利用を開始しました"));
  });

  await step("W5 trial-ending reminder is sent once (dedupe across job runs)", async () => {
    await login("山田 花子", "みなと美容室（オーナー）", "/apps/review-reply");
    const href = await page.locator(".cta-main a", { hasText: "日間無料で試す" }).getAttribute("href");
    await page.goto(BASE + href);
    await page.getByLabel("MarketStars 利用規約に同意します").check();
    await page.getByLabel("提供会社の利用規約・プライバシーポリシーに同意します").check();
    await page.getByRole("button", { name: /日間無料で試す/ }).click();
    await page.waitForURL(/done=1/);
    sql(`UPDATE Subscription SET trialEndsAt = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 2 DAY), currentPeriodEnd = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 2 DAY) WHERE tenantId='demo-tenant-minato' AND status='trialing'`);
    await events();
    await events();
    assert.equal(sql(`SELECT COUNT(*) FROM Notification WHERE tenantId='demo-tenant-minato' AND kind='subscription.trial_ending'`), "1");
    await page.goto(`${BASE}/my/notifications`);
    await see(page.getByText("無料体験がまもなく終了します"));
  });

  await step("W6 non-owner member does not see owner-only notices", async () => {
    await login("佐藤 健", "さくらベーカリー（メンバー）", "/my/notifications");
    await see(page.getByText("AI POPメーカー の無料体験を開始しました"));
    const ownerOnly = sql(`SELECT COUNT(*) FROM Notification WHERE tenantId='demo-tenant-sakura' AND ownerOnly=1`);
    if (Number(ownerOnly) > 0) assert.equal(await page.getByText("お申し込みを受け付けました").count(), 0);
  });
} finally {
  await browser.close();
  recv.close();
}
const failed = results.filter((r) => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
