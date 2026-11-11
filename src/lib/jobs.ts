import { prisma } from "./db";
import { expireDue } from "./subscriptions";
import { computeRanking } from "./catalog";

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
  const expired = await withLock("expire", () => expireDue());
  const last = await prisma.jobLock.findUnique({ where: { name: "ranking" } });
  const rankingDue = !last?.lastRunAt || Date.now() - last.lastRunAt.getTime() > 55 * 60000;
  const ranking = rankingDue ? await withLock("ranking", () => computeRanking()) : "skipped";
  await prisma.authState.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 3600000) } } });
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await prisma.launchTicket.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 86400000) } } });
  return { expired, ranking };
}
