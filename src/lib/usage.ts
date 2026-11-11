import { prisma } from "./db";
import { audit } from "./audit";
import { paymentProvider } from "./payments/provider";

const JST = 9 * 3600000;

/** 日本时间的自然月 [start, end)。month = "YYYY-MM"；省略时为 date 所在月。 */
export function jstMonth(month?: string, date = new Date()) {
  let y: number, m: number;
  if (month) [y, m] = month.split("-").map(Number), (m -= 1);
  else { const j = new Date(date.getTime() + JST); y = j.getUTCFullYear(); m = j.getUTCMonth(); }
  const start = new Date(Date.UTC(y, m, 1) - JST);
  const end = new Date(Date.UTC(y, m + 1, 1) - JST);
  const key = `${y}-${String(m + 1).padStart(2, "0")}`;
  return { key, start, end };
}
export function prevMonth(date = new Date()) {
  const cur = jstMonth(undefined, date);
  return jstMonth(undefined, new Date(cur.start.getTime() - 1));
}

/** 千分之一日元：tokens × 单价(日元/100万) ÷ 1000。 */
export function costMilli(tokens: number, unitPriceJpyPerMTok: number) {
  return Math.ceil((tokens * unitPriceJpyPerMTok) / 1000);
}

export async function monthUsage(subscriptionId: string, month = jstMonth()) {
  const agg = await prisma.usageEvent.aggregate({
    where: { subscriptionId, createdAt: { gte: month.start, lt: month.end } },
    _sum: { inputTokens: true, outputTokens: true, costMilliJpy: true },
    _count: true,
  });
  return {
    requests: agg._count,
    inputTokens: agg._sum.inputTokens ?? 0,
    outputTokens: agg._sum.outputTokens ?? 0,
    costJpy: Math.ceil((agg._sum.costMilliJpy ?? 0) / 1000),
    costMilliJpy: agg._sum.costMilliJpy ?? 0,
  };
}

/**
 * 定时任务：为上个自然月的按量使用生成账单（每订阅每月一条，唯一约束保证幂等）。
 * 卡支付的订阅立即扣款；失败或请求书払い则为 due，由运营确认收款。
 */
export async function billUsage(now = new Date()) {
  const m = prevMonth(now);
  const groups = await prisma.usageEvent.groupBy({ by: ["subscriptionId"], where: { createdAt: { gte: m.start, lt: m.end } }, _sum: { costMilliJpy: true } });
  const out = { created: 0, charged: 0, due: 0, skipped: 0 };
  for (const g of groups) {
    const amount = Math.ceil((g._sum.costMilliJpy ?? 0) / 1000);
    if (amount <= 0) { out.skipped++; continue; }
    const exists = await prisma.billingRecord.findUnique({ where: { subscriptionId_kind_periodStart: { subscriptionId: g.subscriptionId, kind: "usage", periodStart: m.start } } });
    if (exists) { out.skipped++; continue; }
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: g.subscriptionId }, include: { paymentMethod: true } });
    let rec;
    try {
      rec = await prisma.billingRecord.create({ data: { kind: "usage", tenantId: sub.tenantId, subscriptionId: sub.id, amountJpy: amount, status: "due", periodStart: m.start, periodEnd: m.end, note: `モデル利用料 ${m.key}` } });
    } catch { out.skipped++; continue; }
    out.created++;
    if (sub.paymentMode === "card" && sub.paymentMethod?.active) {
      const res = await paymentProvider().charge(sub.paymentMethod.providerRef, amount, `usage:${sub.id}:${m.key}`);
      if (res.ok) {
        await prisma.billingRecord.update({ where: { id: rec.id }, data: { status: "paid", receiptRef: res.chargeId, paidAmountJpy: amount, paidAt: new Date(), confirmedBy: "system" } });
        out.charged++;
      } else {
        await prisma.billingRecord.update({ where: { id: rec.id }, data: { note: `モデル利用料 ${m.key}（カード決済失敗：${res.message}）` } });
        out.due++;
      }
    } else out.due++;
    await audit(prisma, { actorId: "system", actorType: "system", tenantId: sub.tenantId, objectType: "billing", objectId: rec.id, action: "usage_bill", data: { month: m.key, amount } });
  }
  return out;
}
