import { prisma } from "./db";
import { applyScheduledDowngrades, expireDue, renewDue } from "./subscriptions";
import { computeRanking } from "./catalog";
import { billUsage } from "./usage";
import { autoPayouts } from "./payouts";

/** 以 JobLock 行实现跨副本互斥（5 分钟租约），任务本身也是幂等的。 */
async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T | "locked"> {
  const now = new Date();
  await prisma.jobLock.upsert({ where: { name }, create: { name, lockedAt: new Date(0) }, update: {} });
  const got = await prisma.jobLock.updateMany({ where: { name, lockedAt: { lt: new Date(now.getTime() - 5 * 60000) } }, data: { lockedAt: now } });
  if (got.count !== 1) return "locked";
  try {
    const r = await fn();
    await prisma.jobLock.update({ where: { name }, data: { lockedAt: new Date(0), lastRunAt: now, lastResult: JSON.stringify(r) } });
    return r;
  } catch (e) {
    await prisma.jobLock.update({ where: { name }, data: { lockedAt: new Date(0), lastResult: `error: ${String(e)}` } });
    throw e;
  }
}

export async function runJobs() {
  // 顺序：期末降级 → 自动续费 → 到期处理（未续费成功的才会到期）
  const downgraded = await withLock("downgrade", () => applyScheduledDowngrades());
  const renewed = await withLock("renew", () => renewDue());
  const expired = await withLock("expire", () => expireDue());
  // 月初：上月按量账单 → 供应商结算单（均幂等）
  const usage = await withLock("usage", () => billUsage());
  const payouts = await withLock("payouts", () => autoPayouts());
  const last = await prisma.jobLock.findUnique({ where: { name: "ranking" } });
  const rankingDue = !last?.lastRunAt || Date.now() - last.lastRunAt.getTime() > 55 * 60000;
  const ranking = rankingDue ? await withLock("ranking", () => computeRanking()) : "skipped";
  await prisma.authState.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 3600000) } } });
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await prisma.launchTicket.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 86400000) } } });
  return { downgraded, renewed, expired, usage, payouts, ranking };
}
