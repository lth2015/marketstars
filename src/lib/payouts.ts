import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { audit } from "./audit";
import { jstMonth, prevMonth } from "./usage";

/**
 * 生成某月的供应商结算单（自动分账）。
 * 收入 = 当月入账（paidAt）的账单；退款 = 当月退款（refundedAt）的账单，因此结算后发生的退款计入之后的月份。
 * 平台手续费 = (收入 - 退款) × (1 - 分成比例)，日元向下取整给供应商。已存在的结算单不重算。
 */
export async function generatePayouts(month: string, actorId = "system") {
  const m = jstMonth(month);
  if (m.end > new Date()) throw new Error("当月はまだ締められません");
  const providers = await prisma.provider.findMany();
  let created = 0;
  for (const p of providers) {
    if (await prisma.payoutStatement.findUnique({ where: { providerId_month: { providerId: p.id, month: m.key } } })) continue;
    const scope = { subscription: { internalTest: false, app: { providerId: p.id } } };
    const [paid, refunded] = await Promise.all([
      prisma.billingRecord.findMany({ where: { ...scope, paidAt: { gte: m.start, lt: m.end }, status: { in: ["paid", "refunded"] } }, include: { subscription: { include: { app: { select: { slug: true, name: true } } } } } }),
      prisma.billingRecord.findMany({ where: { ...scope, refundedAt: { gte: m.start, lt: m.end } }, include: { subscription: { include: { app: { select: { slug: true, name: true } } } } } }),
    ]);
    if (!paid.length && !refunded.length) continue;
    const gross = paid.reduce((a, b) => a + b.amountJpy, 0);
    const refund = refunded.reduce((a, b) => a + b.amountJpy, 0);
    const net = gross - refund;
    const payout = Math.floor((net * p.revenueShareBps) / 10000);
    const byApp = new Map<string, { app: string; gross: number; refund: number; count: number }>();
    for (const r of paid) { const k = r.subscription.app.slug; const v = byApp.get(k) ?? { app: r.subscription.app.name, gross: 0, refund: 0, count: 0 }; v.gross += r.amountJpy; v.count++; byApp.set(k, v); }
    for (const r of refunded) { const k = r.subscription.app.slug; const v = byApp.get(k) ?? { app: r.subscription.app.name, gross: 0, refund: 0, count: 0 }; v.refund += r.amountJpy; byApp.set(k, v); }
    try {
      const st = await prisma.payoutStatement.create({ data: { providerId: p.id, month: m.key, grossJpy: gross, refundJpy: refund, platformFeeJpy: net - payout, payoutJpy: payout, shareBps: p.revenueShareBps, lines: [...byApp.values()] as unknown as Prisma.InputJsonValue } });
      await audit(prisma, { actorId, actorType: actorId === "system" ? "system" : "operator", objectType: "payout", objectId: st.id, action: "generate", data: { month: m.key, payout } });
      created++;
    } catch { /* 并发生成：唯一约束保证一份 */ }
  }
  return created;
}

/** 定时任务：每月初自动生成上月结算单。 */
export async function autoPayouts(now = new Date()) {
  return generatePayouts(prevMonth(now).key);
}
