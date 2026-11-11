// 数据库固定窗口限流（多副本共享）。LB 层由 Cloud Armor 做粗粒度限流，这里按业务键做细粒度限制。
import { headers } from "next/headers";
import { prisma } from "./db";

/**
 * 客户端 IP。GCP 外部 LB 会在 X-Forwarded-For 末尾追加 "<client-ip>, <lb-ip>"，
 * 客户端自己发送的值在更前面，不可信。TRUSTED_PROXY_HOPS = 末尾属于可信代理的条数（GCP LB 为 1）。
 */
export function clientIp(xff: string | null, hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 0)) {
  // hops=0：前面没有可信代理，X-Forwarded-For 完全由客户端提供，不可信，整体忽略
  if (!(hops > 0)) return "direct";
  const list = (xff ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length <= hops) return "unknown";
  return list[list.length - 1 - hops];
}

export async function ipFromRequest(req?: Request) {
  const xff = req ? req.headers.get("x-forwarded-for") : (await headers()).get("x-forwarded-for");
  return clientIp(xff);
}

export const LIMITS = {
  authStart: { limit: 30, windowSec: 60 },
  authCallback: { limit: 60, windowSec: 60 },
  contact: { limit: 5, windowSec: 600 },
  agentApi: { limit: 120, windowSec: 60 },
  modelGateway: { limit: 120, windowSec: 60 },
  launchExchange: { limit: 60, windowSec: 60 },
  paymentWebhook: { limit: 300, windowSec: 60 },
  apply: { limit: 20, windowSec: 60 },
} as const;

/** 计数并判断是否超限。返回 retryAfter 秒数（超限时）。数据库异常时放行（fail-open），避免限流故障拖垮业务。 */
export async function hit(key: string, rule: { limit: number; windowSec: number }): Promise<{ ok: boolean; retryAfter: number }> {
  if (process.env.RATE_LIMIT_DISABLED === "true") return { ok: true, retryAfter: 0 };
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / (rule.windowSec * 1000)) * rule.windowSec * 1000);
  const retryAfter = Math.ceil((windowStart.getTime() + rule.windowSec * 1000 - now) / 1000);
  try {
    // INSERT … ON DUPLICATE KEY UPDATE：原子自增，多副本安全
    await prisma.$executeRaw`INSERT INTO RateLimit (\`key\`, windowStart, count) VALUES (${key}, ${windowStart}, 1) ON DUPLICATE KEY UPDATE count = count + 1`;
    const row = await prisma.rateLimit.findUnique({ where: { key_windowStart: { key, windowStart } } });
    return { ok: (row?.count ?? 0) <= rule.limit, retryAfter };
  } catch {
    return { ok: true, retryAfter: 0 };
  }
}

/** 按客户端 IP 限流。识别不出 IP（无可信代理 / 缺少 XFF）时不限流，交给 LB 层的 Cloud Armor。 */
export async function limitIp(prefix: string, rule: { limit: number; windowSec: number }, req?: Request) {
  const ip = await ipFromRequest(req);
  if (ip === "direct" || ip === "unknown") return { ok: true, retryAfter: 0 };
  return hit(`${prefix}:ip:${ip}`, rule);
}

export function tooMany(retryAfter: number) {
  return Response.json({ type: "https://marketstars.example/problems/rate_limited", title: "rate_limited", status: 429, detail: "Too many requests" }, { status: 429, headers: { "retry-after": String(retryAfter), "content-type": "application/problem+json" } });
}

export async function cleanupRateLimits() {
  const r = await prisma.rateLimit.deleteMany({ where: { windowStart: { lt: new Date(Date.now() - 3600000) } } });
  return r.count;
}
