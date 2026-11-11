// 领域事件：业务事务内写入 outbox（DomainEvent），由定时任务分发为站内通知、邮件和提供商 Webhook。
import type { Prisma, Subscription } from "@prisma/client";
import { prisma } from "./db";

type Tx = Prisma.TransactionClient | typeof prisma;

export type EventSpec = {
  title: (p: EventPayload) => string;
  body: (p: EventPayload) => string;
  link?: (p: EventPayload) => string;
  ownerOnly?: boolean;
  email?: boolean;
  /** 是否推送给该应用的提供商 Webhook */
  webhook?: boolean;
};

export type EventPayload = {
  appName?: string;
  appSlug?: string;
  subscription?: ReturnType<typeof subscriptionSnapshot>;
  amountJpy?: number;
  reason?: string | null;
  [k: string]: unknown;
};

const yen = (n?: number) => (n === undefined ? "" : `¥${n.toLocaleString("ja-JP")}`);
const d = (iso?: string | null) => (iso ? new Date(new Date(iso).getTime() + 9 * 3600000).toISOString().slice(0, 16).replace("T", " ") : "—");
const sub = (p: EventPayload) => p.subscription!;
const myApp = (p: EventPayload) => `/my/apps/${p.subscription?.id ?? ""}`;

/** 事件目录：类型 → 通知文案与分发渠道。未列出的类型只记录、不通知。 */
export const EVENTS: Record<string, EventSpec> = {
  "subscription.trial_started": { title: (p) => `${p.appName} の無料体験を開始しました`, body: (p) => `体験期間は ${d(sub(p).trial_ends_at)} までです。終了後に自動で課金されることはありません。`, link: myApp, webhook: true },
  "subscription.activated": { title: (p) => `${p.appName} の利用を開始しました`, body: (p) => `プラン：${sub(p).plan_name}${sub(p).current_period_end ? `（${d(sub(p).current_period_end)} まで）` : ""}`, link: myApp, email: true, webhook: true },
  "application.submitted": { title: (p) => `${p.appName} のお申し込みを受け付けました`, body: () => "運営が契約内容とお支払いを確認した後に利用開始となります。", link: myApp, ownerOnly: true, email: true, webhook: true },
  "application.rejected": { title: (p) => `${p.appName} のお申し込みについて`, body: (p) => `今回はお申し込みをお受けできませんでした。${p.reason ? `理由：${p.reason}` : ""}`, link: myApp, ownerOnly: true, email: true, webhook: true },
  "subscription.withdrawn": { title: (p) => `${p.appName} のお申し込みを取り下げました`, body: () => "", link: myApp, ownerOnly: true, webhook: true },
  "subscription.renewed": { title: (p) => `${p.appName} の利用期間を更新しました`, body: (p) => `次の期間：${d(sub(p).current_period_end)} まで`, link: myApp, ownerOnly: true, email: true, webhook: true },
  "subscription.plan_changed": { title: (p) => `${p.appName} のプランを変更しました`, body: (p) => `新しいプラン：${sub(p).plan_name}`, link: myApp, ownerOnly: true, email: true, webhook: true },
  "subscription.plan_change_scheduled": { title: (p) => `${p.appName} のプラン変更を予約しました`, body: () => "現在の利用期間の終了時に変更されます。", link: myApp, ownerOnly: true },
  "subscription.cancel_scheduled": { title: (p) => `${p.appName} の解約を受け付けました`, body: (p) => `${d(sub(p).cancel_at)} まで利用できます。`, link: myApp, ownerOnly: true, email: true, webhook: true },
  "subscription.cancel_reverted": { title: (p) => `${p.appName} の解約を取り消しました`, body: () => "", link: myApp, ownerOnly: true, webhook: true },
  "subscription.canceled": { title: (p) => `${p.appName} の利用を終了しました`, body: () => "アカウントは削除されません。アプリ側のデータの扱いは提供会社にお問い合わせください。", link: myApp, email: true, webhook: true },
  "subscription.trial_ended": { title: (p) => `${p.appName} の無料体験を終了しました`, body: () => "続けて利用する場合は有料プランをお申し込みください。", link: myApp, webhook: true },
  "subscription.expired": { title: (p) => `${p.appName} の利用期間が終了しました`, body: () => "引き続き利用する場合は、改めてお申し込みください。", link: myApp, email: true, webhook: true },
  "subscription.suspended": { title: (p) => `${p.appName} の利用が一時停止されました`, body: (p) => `理由：${p.reason ?? "—"}`, link: myApp, email: true, webhook: true },
  "subscription.resumed": { title: (p) => `${p.appName} の利用を再開しました`, body: () => "", link: myApp, webhook: true },
  "subscription.trial_ending": { title: (p) => `${p.appName} の無料体験がまもなく終了します`, body: (p) => `${d(sub(p).trial_ends_at)} に終了します。自動で課金されることはありません。続けて利用する場合は有料プランへお切り替えください。`, link: myApp, ownerOnly: true, email: true },
  "subscription.renewal_due": { title: (p) => `${p.appName} の利用期間がまもなく終了します`, body: (p) => `${d(sub(p).current_period_end)} に終了します。継続する場合はお支払いの手続きをお願いします（自動更新はオフです）。`, link: myApp, ownerOnly: true, email: true },
  "payment.succeeded": { title: (p) => `${p.appName}：${yen(p.amountJpy)} のお支払いを確認しました`, body: () => "", link: () => "/my/billing", ownerOnly: true, webhook: true },
  "payment.failed": { title: (p) => `${p.appName}：お支払いに失敗しました`, body: (p) => `${p.reason ?? ""} 期間終了までにカードを確認してください。`, link: () => "/my/billing", ownerOnly: true, email: true, webhook: true },
  "app.submission_approved": { title: (p) => `${p.appName} の審査が承認されました`, body: () => "アプリが公開されました。", link: (p) => `/developer/apps/${p.appId ?? ""}`, ownerOnly: true, email: true },
  "app.submission_rejected": { title: (p) => `${p.appName} が差し戻されました`, body: (p) => `運営からのコメント：${p.reason ?? ""}`, link: (p) => `/developer/apps/${p.appId ?? ""}`, ownerOnly: true, email: true },
  "review.created": { title: (p) => `${p.appName} に新しいレビュー（★${p.rating}）`, body: (p) => String(p.reviewTitle ?? ""), link: (p) => `/developer/apps/${p.appId ?? ""}`, ownerOnly: true },
};

export function subscriptionSnapshot(s: Subscription & { plan?: { planKey: string } | null }) {
  const iso = (x: Date | null) => x?.toISOString() ?? null;
  return {
    id: s.id, tenant_id: s.tenantId, status: s.status, kind: s.kind, plan_key: s.plan?.planKey ?? null, plan_name: s.planNameSnapshot, price_jpy: s.priceJpySnapshot,
    payment_mode: s.paymentMode, auto_renew: s.autoRenew, started_at: iso(s.startedAt), trial_ends_at: iso(s.trialEndsAt), current_period_start: iso(s.currentPeriodStart),
    current_period_end: iso(s.currentPeriodEnd), cancel_at: iso(s.cancelAt), ended_at: iso(s.endedAt),
  };
}

/** 写入事件（与业务写入同一事务时传入 tx）。dedupeKey 冲突时忽略（同一提醒只发一次）。 */
export async function emitEvent(tx: Tx, e: { type: string; tenantId?: string | null; appId?: string | null; subscriptionId?: string | null; payload: EventPayload; dedupeKey?: string }) {
  try {
    await tx.domainEvent.create({ data: { type: e.type, tenantId: e.tenantId ?? null, appId: e.appId ?? null, subscriptionId: e.subscriptionId ?? null, payload: e.payload as Prisma.InputJsonValue, dedupeKey: e.dedupeKey ?? null } });
  } catch (err) {
    if (e.dedupeKey && (err as { code?: string }).code === "P2002") return;
    throw err;
  }
}

/** 订阅相关事件的便捷写入（会读取应用名与套餐键）。 */
export async function emitSubscriptionEvent(tx: Tx, type: string, subId: string, extra: Partial<EventPayload> = {}, dedupeKey?: string) {
  const s = await tx.subscription.findUniqueOrThrow({ where: { id: subId }, include: { plan: { select: { planKey: true } }, app: { select: { name: true, slug: true } } } });
  await emitEvent(tx, { type, tenantId: s.tenantId, appId: s.appId, subscriptionId: s.id, payload: { appName: s.app.name, appSlug: s.app.slug, subscription: subscriptionSnapshot(s), ...extra }, dedupeKey });
}

/** 审计动作 → 事件类型。 */
export const ACTION_EVENTS: Record<string, string | ((toState: string) => string)> = {
  withdraw: "subscription.withdrawn",
  end_trial: "subscription.trial_ended",
  cancel_free: "subscription.canceled",
  operator_cancel: "subscription.canceled",
  cancel_at_period_end: "subscription.cancel_scheduled",
  operator_cancel_at_period_end: "subscription.cancel_scheduled",
  undo_cancel: "subscription.cancel_reverted",
  reject: "application.rejected",
  suspend: "subscription.suspended",
  resume: "subscription.resumed",
  period_end: (to) => (to === "canceled" ? "subscription.canceled" : "subscription.expired"),
};

/** 可订阅的 Webhook 事件类型（EVENTS 中 webhook=true 的类型）。 */
export const WEBHOOK_EVENT_TYPES = Object.entries(EVENTS).filter(([, v]) => v.webhook).map(([k]) => k);
