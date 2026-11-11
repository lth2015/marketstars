// 事件分发：站内通知、邮件 outbox、Webhook 投递记录；以及提醒类事件的生成。
import { prisma } from "./db";
import { EVENTS, emitSubscriptionEvent, type EventPayload } from "./events";
import { sendMail } from "./mailer";
import { config } from "./config";
import { addDays } from "./time";

export async function processEvents(limit = 200) {
  const events = await prisma.domainEvent.findMany({ where: { processedAt: null }, orderBy: { createdAt: "asc" }, take: limit });
  let n = 0;
  for (const ev of events) {
    const spec = EVENTS[ev.type];
    const p = ev.payload as EventPayload;
    if (spec && ev.tenantId) {
      const title = spec.title(p);
      const body = spec.body(p);
      const link = spec.link?.(p) ?? null;
      await prisma.notification.upsert({ where: { tenantId_eventId: { tenantId: ev.tenantId, eventId: ev.id } }, create: { tenantId: ev.tenantId, eventId: ev.id, kind: ev.type, title, body, link, ownerOnly: !!spec.ownerOnly }, update: {} });
      if (spec.email) {
        const contacts = await prisma.tenantContact.findMany({ where: { tenantId: ev.tenantId } });
        for (const c of contacts) {
          const text = `${body}\n\n${link ? `${config.baseUrl}${link}\n\n` : ""}— MarketStars\nこのメールは送信専用です。お問い合わせは ${config.baseUrl}/contact からお願いします。`;
          await prisma.emailOutbox.upsert({ where: { eventId_to: { eventId: ev.id, to: c.email } }, create: { to: c.email, subject: `[MarketStars] ${title}`, body: text, eventId: ev.id }, update: {} });
        }
      }
    }
    if (spec?.webhook && ev.appId) {
      const endpoints = await prisma.webhookEndpoint.findMany({ where: { appId: ev.appId, enabled: true } });
      for (const e of endpoints) {
        const types = e.eventTypes.split(",");
        if (!types.includes("*") && !types.includes(ev.type)) continue;
        await prisma.webhookDelivery.upsert({ where: { endpointId_eventId: { endpointId: e.id, eventId: ev.id } }, create: { endpointId: e.id, eventId: ev.id }, update: {} });
      }
    }
    await prisma.domainEvent.update({ where: { id: ev.id }, data: { processedAt: new Date() } });
    n++;
  }
  return n;
}

export async function sendPendingEmails(limit = 50) {
  const rows = await prisma.emailOutbox.findMany({ where: { status: "pending" }, orderBy: { createdAt: "asc" }, take: limit });
  let sent = 0;
  for (const m of rows) {
    const claim = await prisma.emailOutbox.updateMany({ where: { id: m.id, status: "pending", attempts: m.attempts }, data: { attempts: { increment: 1 } } });
    if (!claim.count) continue;
    try {
      await sendMail({ to: m.to, subject: m.subject, text: m.body });
      await prisma.emailOutbox.update({ where: { id: m.id }, data: { status: "sent", sentAt: new Date(), lastError: null } });
      sent++;
    } catch (e) {
      await prisma.emailOutbox.update({ where: { id: m.id }, data: { status: m.attempts + 1 >= 3 ? "failed" : "pending", lastError: String(e).slice(0, 1000) } });
    }
  }
  return sent;
}

/** 提醒：试用 3 天内结束；未开自动续费的付费订阅 7 天内到期。dedupeKey 保证每次只提醒一次。 */
export async function emitReminders(now = new Date()) {
  let n = 0;
  const trials = await prisma.subscription.findMany({ where: { status: "trialing", trialEndsAt: { gt: now, lte: addDays(now, 3) } }, select: { id: true } });
  for (const t of trials) { await emitSubscriptionEvent(prisma, "subscription.trial_ending", t.id, {}, `trial_ending:${t.id}`); n++; }
  const renewals = await prisma.subscription.findMany({ where: { status: "active", kind: "paid", autoRenew: false, currentPeriodEnd: { gt: now, lte: addDays(now, 7) } }, select: { id: true, currentPeriodEnd: true } });
  for (const r of renewals) { await emitSubscriptionEvent(prisma, "subscription.renewal_due", r.id, {}, `renewal_due:${r.id}:${r.currentPeriodEnd!.toISOString()}`); n++; }
  return n;
}

/** owner 登录时记录联系邮箱（供邮件通知使用）。 */
export async function recordTenantContact(s: { tenantId: string | null; userId: string; email?: string | null; isOwner: boolean }) {
  if (!s.tenantId || !s.email || !s.isOwner) return;
  await prisma.tenantContact.upsert({ where: { tenantId_userId: { tenantId: s.tenantId, userId: s.userId } }, create: { tenantId: s.tenantId, userId: s.userId, email: s.email }, update: { email: s.email } });
}
