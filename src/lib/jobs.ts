import { prisma } from "./db";
import { applyScheduledDowngrades, expireDue, renewDue } from "./subscriptions";
import { computeRanking } from "./catalog";
import { billUsage } from "./usage";
import { autoPayouts } from "./payouts";
import { anchorLedger, ingestLedger } from "./ledger";
import { emitReminders, processEvents, sendPendingEmails } from "./notify";
import { deliverDueWebhooks } from "./webhooks";
import { cleanupRateLimits } from "./ratelimit";

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

/** 事件分发（可每分钟执行）：提醒 → 事件扇出 → Webhook 投递 → 邮件发送。均幂等。 */
export async function runEventJobs() {
  const reminders = await withLock("reminders", () => emitReminders());
  const events = await withLock("events", () => processEvents());
  const webhooks = await withLock("webhooks", () => deliverDueWebhooks());
  const emails = await withLock("emails", () => sendPendingEmails());
  return { reminders, events, webhooks, emails };
}

export async function runJobs() {
  // 顺序：期末降级 → 自动续费 → 到期处理（未续费成功的才会到期）
  const downgraded = await withLock("downgrade", () => applyScheduledDowngrades());
  const renewed = await withLock("renew", () => renewDue());
  const expired = await withLock("expire", () => expireDue());
  // 月初：上月按量账单 → 供应商结算单（均幂等）
  const usage = await withLock("usage", () => billUsage());
  const payouts = await withLock("payouts", () => autoPayouts());
  // 资金事件写入防篡改台帐；链头变化时生成锚点
  const ledger = await withLock("ledger", async () => ({ appended: await ingestLedger(), anchor: (await anchorLedger())?.seq ?? null }));
  const last = await prisma.jobLock.findUnique({ where: { name: "ranking" } });
  const rankingDue = !last?.lastRunAt || Date.now() - last.lastRunAt.getTime() > 55 * 60000;
  const ranking = rankingDue ? await withLock("ranking", () => computeRanking()) : "skipped";
  await prisma.authState.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 3600000) } } });
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await cleanupRateLimits();
  await prisma.launchTicket.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 86400000) } } });
  const dispatch = await runEventJobs();
  return { downgraded, renewed, expired, usage, payouts, ledger, ranking, dispatch };
}
