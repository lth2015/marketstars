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

function privateV4(ip: string) {
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

/** IPv6 を 8 つの 16bit 値に展開（:: の省略と末尾の IPv4 表記に対応）。 */
function v6Words(ip: string): number[] | null {
  let v = ip.toLowerCase().split("%")[0];
  const m = v.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (m) {
    if (!net.isIPv4(m[2])) return null;
    const [a, b, c, d] = m[2].split(".").map(Number);
    v = `${m[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = v.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : [];
  const words = tail !== undefined ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t] : h;
  if (words.length !== 8) return null;
  const n = words.map((w) => parseInt(w || "0", 16));
  return n.some((x) => Number.isNaN(x) || x < 0 || x > 0xffff) ? null : n;
}

export function isPrivateAddress(raw: string): boolean {
  const ip = raw.replace(/^\[|\]$/g, "");
  if (net.isIPv4(ip)) return privateV4(ip);
  const w = v6Words(ip);
  if (!w) return true; // 解析できないアドレスは安全側に倒す
  const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  const zero = (n: number) => w.slice(0, n).every((x) => x === 0);
  if (zero(8) || (zero(7) && w[7] === 1)) return true; // :: / ::1
  if (zero(5) && w[5] === 0xffff) return privateV4(v4(w[6], w[7])); // ::ffff:a.b.c.d（16 進表記も含む）
  if (zero(6)) return privateV4(v4(w[6], w[7])); // IPv4 互換 ::a.b.c.d
  if (w[0] === 0x64 && w[1] === 0xff9b) return true; // NAT64 64:ff9b::/96
  if (w[0] === 0x100 && w[1] === 0 && w[2] === 0 && w[3] === 0) return true; // 破棄用 100::/64
  if (w[0] === 0x2001 && w[1] === 0xdb8) return true; // ドキュメント用
  if (w[0] === 0x2002) return true; // 6to4（内部の IPv4 を包める）
  const top = w[0] >> 8;
  return (w[0] & 0xfe00) === 0xfc00 || (w[0] & 0xffc0) === 0xfe80 || top === 0xff; // ULA / リンクローカル / マルチキャスト
}

/** URL のホスト名から角括弧を外す（WHATWG URL は IPv6 リテラルを [..] のまま返す）。 */
const bareHost = (u: URL) => u.hostname.replace(/^\[|\]$/g, "");

/** 配置时的 URL 校验（连接时还会再按解析结果校验）。 */
export function validateWebhookUrl(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return "URL の形式が正しくありません。"; }
  if (u.username || u.password) return "URL に認証情報を含めないでください。";
  if (u.protocol !== "https:" && !(allowPrivate() && u.protocol === "http:")) return "https の URL を指定してください。";
  const host = bareHost(u);
  if (!allowPrivate() && (host === "localhost" || host.endsWith(".localhost") || (net.isIP(host) && isPrivateAddress(host)))) return "社内・ローカルのアドレスは指定できません。";
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
    // IP リテラルのホストでは lookup が呼ばれないため、接続前にここで確認する
    const host = bareHost(u);
    if (net.isIP(host) && isPrivateAddress(host) && !allowPrivate()) return reject(new Error(`blocked private address ${host}`));
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
  if (!d.endpoint.enabled) return d.status; // 無効化された送信先には送らない
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
