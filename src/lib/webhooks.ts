// 提供商 Webhook：HMAC 签名、指数退避重试、连接时校验目标 IP（防 SSRF / DNS rebinding）。
import crypto from "node:crypto";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { prisma } from "./db";
import { config } from "./config";

/** 签名密钥由主密钥与端点 ID 派生，不入库；轮换主密钥会同时轮换全部 Webhook 密钥。 */
export function webhookSecret(endpointId: string) {
  return "whsec_" + crypto.createHmac("sha256", config.sessionSecret).update(`webhook:${endpointId}`).digest("base64url");
}

/** 签名头：t=时间戳,v1=hex(HMAC-SHA256(secret, `${t}.${body}`))。接收方应校验并拒绝 5 分钟以上的旧请求。 */
export function signPayload(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

export function verifySignature(secret: string, body: string, header: string, toleranceSec = 300) {
  const m = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(header);
  if (!m) return false;
  if (Math.abs(Date.now() / 1000 - Number(m[1])) > toleranceSec) return false;
  const expected = signPayload(secret, body, Number(m[1])).split("v1=")[1];
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(m[2]));
}

const allowPrivate = () => process.env.WEBHOOK_ALLOW_PRIVATE === "true";

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff");
}

/** 配置时的 URL 校验（连接时还会再按解析结果校验）。 */
export function validateWebhookUrl(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return "URL の形式が正しくありません。"; }
  if (u.username || u.password) return "URL に認証情報を含めないでください。";
  if (u.protocol !== "https:" && !(allowPrivate() && u.protocol === "http:")) return "https の URL を指定してください。";
  if (!allowPrivate() && (u.hostname === "localhost" || (net.isIP(u.hostname) && isPrivateAddress(u.hostname)))) return "社内・ローカルのアドレスは指定できません。";
  return null;
}

/** 解析域名后检查每个地址；在连接阶段使用，避免校验与连接之间被 DNS 重绑定。 */
const guardedLookup: net.LookupFunction = (hostname, options, cb) => {
  dns.lookup(hostname, { all: true }, (err, addrs) => {
    if (err) return (cb as (e: Error | null, a?: string, f?: number) => void)(err);
    const list = addrs as dns.LookupAddress[];
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad && !allowPrivate()) return (cb as (e: Error) => void)(new Error(`blocked private address ${bad.address}`));
    const first = list[0];
    if ((options as dns.LookupOptions).all) return (cb as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    (cb as (e: null, a: string, f: number) => void)(null, first.address, first.family);
  });
};

export function postSigned(url: string, body: string, headers: Record<string, string>, timeoutMs = 10000): Promise<{ status: number; snippet: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(u, { method: "POST", headers: { "content-type": "application/json", "user-agent": "MarketStars-Webhooks/1.0", "content-length": Buffer.byteLength(body).toString(), ...headers }, lookup: guardedLookup, timeout: timeoutMs }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { if (data.length < 500) data += c; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, snippet: data.slice(0, 500) }));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(body);
  });
}

const BACKOFF_SEC = [60, 300, 1800, 7200, 43200];
export const MAX_ATTEMPTS = BACKOFF_SEC.length + 1;

export function webhookBody(ev: { id: string; type: string; createdAt: Date; payload: unknown; appId: string | null }) {
  const p = ev.payload as Record<string, unknown>;
  return JSON.stringify({ id: ev.id, type: ev.type, created_at: ev.createdAt.toISOString(), data: { app: p.appSlug ?? null, subscription: p.subscription ?? null, amount_jpy: p.amountJpy ?? null, reason: p.reason ?? null } });
}

export async function deliverOne(deliveryId: string) {
  const d = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: deliveryId }, include: { endpoint: true, event: true } });
  if (d.status === "succeeded" || d.status === "dead") return d.status;
  const body = webhookBody(d.event);
  const attempts = d.attempts + 1;
  let ok = false, status: number | null = null, error: string | null = null;
  try {
    const r = await postSigned(d.endpoint.url, body, { "x-marketstars-event": d.event.type, "x-marketstars-delivery": d.id, "x-marketstars-signature": signPayload(webhookSecret(d.endpointId), body) });
    status = r.status;
    ok = r.status >= 200 && r.status < 300;
    if (!ok) error = `HTTP ${r.status} ${r.snippet}`.slice(0, 1000);
  } catch (e) {
    error = String((e as Error).message).slice(0, 1000);
  }
  const next = ok ? "succeeded" : attempts >= MAX_ATTEMPTS ? "dead" : "failed";
  await prisma.webhookDelivery.update({ where: { id: d.id }, data: { status: next, attempts, lastStatus: status, lastError: error, succeededAt: ok ? new Date() : null, nextAttemptAt: new Date(Date.now() + (BACKOFF_SEC[attempts - 1] ?? 0) * 1000) } });
  return next;
}

/** 定时任务：发送到期的 Webhook（条件更新抢占，避免多副本重复发送）。 */
export async function deliverDueWebhooks(limit = 50) {
  const due = await prisma.webhookDelivery.findMany({ where: { status: { in: ["pending", "failed"] }, nextAttemptAt: { lte: new Date() } }, orderBy: { nextAttemptAt: "asc" }, take: limit });
  const out = { succeeded: 0, failed: 0, dead: 0 };
  for (const d of due) {
    const claim = await prisma.webhookDelivery.updateMany({ where: { id: d.id, status: d.status, attempts: d.attempts }, data: { nextAttemptAt: new Date(Date.now() + 120000) } });
    if (!claim.count) continue;
    const r = await deliverOne(d.id);
    if (r === "succeeded") out.succeeded++; else if (r === "dead") out.dead++; else out.failed++;
  }
  return out;
}
