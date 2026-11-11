// 运营 KPI 与开发者分析。金额为税込日元；排除社内テスト。月份按日本时间。
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { jstMonth } from "./usage";

const LIVE = ["trialing", "active", "cancel_scheduled", "suspended"];

export function lastMonths(n: number, now = new Date()) {
  const out = [];
  let m = jstMonth(undefined, now);
  for (let i = 0; i < n; i++) { out.unshift(m); m = jstMonth(undefined, new Date(m.start.getTime() - 1)); }
  return out;
}

export async function kpis(scope: { appIds?: string[] } = {}, now = new Date()) {
  const app: Prisma.SubscriptionWhereInput = scope.appIds ? { appId: { in: scope.appIds } } : {};
  const base: Prisma.SubscriptionWhereInput = { internalTest: false, ...app };
  const since90 = new Date(now.getTime() - 90 * 86400000);
  const since30 = new Date(now.getTime() - 30 * 86400000);
  const [paidActive, liveByKind, trials, churned] = await Promise.all([
    prisma.subscription.findMany({ where: { ...base, kind: "paid", status: { in: ["active", "cancel_scheduled", "suspended"] }, currentPeriodEnd: { gt: now } }, select: { priceJpySnapshot: true, appId: true } }),
    prisma.subscription.groupBy({ by: ["kind"], where: { ...base, status: { in: LIVE } }, _count: true }),
    prisma.trialUsage.findMany({ where: { startedAt: { gte: since90 }, ...(scope.appIds ? { appId: { in: scope.appIds } } : {}) } }),
    prisma.subscription.count({ where: { ...base, kind: "paid", status: { in: ["canceled", "expired"] }, endedAt: { gte: since30 } } }),
  ]);
  // 试用转化：90 天内开始的试用中，同空间同应用之后有付费开通的比例
  let converted = 0;
  for (const t of trials) {
    const paid = await prisma.subscription.count({ where: { tenantId: t.tenantId, appId: t.appId, kind: "paid", startedAt: { gte: t.startedAt }, status: { notIn: ["pending", "rejected", "withdrawn"] } } });
    if (paid) converted++;
  }
  const mrr = paidActive.reduce((a, s) => a + s.priceJpySnapshot, 0);
  const count = (k: string) => liveByKind.find((x) => x.kind === k)?._count ?? 0;
  const paidNow = paidActive.length;
  return {
    mrr,
    active: { paid: count("paid"), free: count("free"), trial: count("trial") },
    trial: { started: trials.length, converted, rate: trials.length ? converted / trials.length : null },
    churn: { ended: churned, base: paidNow + churned, rate: paidNow + churned ? churned / (paidNow + churned) : null },
    mrrByApp: paidActive.reduce<Record<string, number>>((acc, s) => ((acc[s.appId] = (acc[s.appId] ?? 0) + s.priceJpySnapshot), acc), {}),
  };
}

/** 月度收入（入账 - 当月退款），按月费 / AI 按量拆分。 */
export async function revenueByMonth(months = 6, scope: { appIds?: string[] } = {}) {
  const ms = lastMonths(months);
  const where: Prisma.BillingRecordWhereInput = { subscription: { internalTest: false, ...(scope.appIds ? { appId: { in: scope.appIds } } : {}) } };
  const [paid, refunded] = await Promise.all([
    prisma.billingRecord.findMany({ where: { ...where, paidAt: { gte: ms[0].start } }, select: { kind: true, amountJpy: true, paidAt: true } }),
    prisma.billingRecord.findMany({ where: { ...where, refundedAt: { gte: ms[0].start } }, select: { kind: true, amountJpy: true, refundedAt: true } }),
  ]);
  return ms.map((m) => {
    const inM = (d: Date | null) => !!d && d >= m.start && d < m.end;
    const sum = (k: string) => paid.filter((b) => b.kind === k && inM(b.paidAt)).reduce((a, b) => a + b.amountJpy, 0) - refunded.filter((b) => b.kind === k && inM(b.refundedAt)).reduce((a, b) => a + b.amountJpy, 0);
    return { month: m.key, subscription: sum("subscription"), usage: sum("usage") };
  });
}

/** 月度新增利用开始（不含试用）。 */
export async function activationsByMonth(months = 6, scope: { appIds?: string[] } = {}) {
  const ms = lastMonths(months);
  const rows = await prisma.subscription.findMany({ where: { internalTest: false, kind: { in: ["paid", "free"] }, startedAt: { gte: ms[0].start }, status: { notIn: ["pending", "rejected", "withdrawn"] }, ...(scope.appIds ? { appId: { in: scope.appIds } } : {}) }, select: { startedAt: true } });
  return ms.map((m) => ({ month: m.key, count: rows.filter((r) => r.startedAt! >= m.start && r.startedAt! < m.end).length }));
}

export async function perAppStats(appIds: string[], now = new Date()) {
  const since90 = new Date(now.getTime() - 90 * 86400000);
  const m = jstMonth(undefined, now);
  return Promise.all(appIds.map(async (id) => {
    const [live, trials, usage] = await Promise.all([
      prisma.subscription.groupBy({ by: ["kind"], where: { appId: id, internalTest: false, status: { in: LIVE } }, _count: true }),
      prisma.trialUsage.findMany({ where: { appId: id, startedAt: { gte: since90 } } }),
      prisma.usageEvent.aggregate({ where: { appId: id, createdAt: { gte: m.start, lt: m.end } }, _sum: { inputTokens: true, outputTokens: true, costMilliJpy: true }, _count: true }),
    ]);
    let converted = 0;
    for (const t of trials) if (await prisma.subscription.count({ where: { tenantId: t.tenantId, appId: id, kind: "paid", startedAt: { gte: t.startedAt }, status: { notIn: ["pending", "rejected", "withdrawn"] } } })) converted++;
    const c = (k: string) => live.find((x) => x.kind === k)?._count ?? 0;
    return { appId: id, paid: c("paid"), free: c("free"), trial: c("trial"), trialsStarted: trials.length, trialsConverted: converted, usageRequests: usage._count, usageTokens: (usage._sum.inputTokens ?? 0) + (usage._sum.outputTokens ?? 0), usageJpy: Math.ceil((usage._sum.costMilliJpy ?? 0) / 1000) };
  }));
}
