import { Prisma, type Subscription } from "@prisma/client";
import { prisma } from "./db";
import { audit } from "./audit";
import { addDays, addOneMonthJst } from "./time";
import { config } from "./config";
import type { SessionUser } from "./session";
import { paymentProvider, type CardInput } from "./payments/provider";
import { ACTION_EVENTS, emitSubscriptionEvent } from "./events";

export const LIVE_STATUSES = ["pending", "trialing", "active", "cancel_scheduled", "suspended"];
export const STATUS_LABEL: Record<string, string> = {
  pending: "申込中",
  trialing: "無料体験中",
  active: "利用中",
  cancel_scheduled: "解約予定",
  expired: "期間終了",
  canceled: "解約済み",
  suspended: "一時停止中",
  rejected: "お申し込み不可",
  withdrawn: "取り下げ済み",
};

export class BizError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

const liveKey = (tenantId: string, appId: string) => `${tenantId}:${appId}`;
const isUnique = (e: unknown, field?: string) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && (!field || JSON.stringify(e.meta ?? {}).includes(field));

/** 当前是否拥有可使用的权益（后端权威判断）。 */
export function isEntitled(s: Pick<Subscription, "status" | "kind" | "trialEndsAt" | "currentPeriodEnd" | "cancelAt">, now = new Date()) {
  if (s.status === "trialing") return !!s.trialEndsAt && s.trialEndsAt > now;
  if (s.status === "active") return s.kind === "free" || (!!s.currentPeriodEnd && s.currentPeriodEnd > now);
  if (s.status === "cancel_scheduled") return !!s.cancelAt && s.cancelAt > now;
  return false;
}

export async function liveSubscription(tenantId: string, appId: string) {
  return prisma.subscription.findUnique({ where: { liveKey: liveKey(tenantId, appId) }, include: { plan: true } });
}

/** 附带待支付 intent（在线支付开通时跳转支付页）。 */
async function withIntent(sub: Subscription) {
  const intent = sub.status === "pending" && sub.paymentMode === "card" ? await prisma.paymentIntent.findFirst({ where: { subscriptionId: sub.id, purpose: "activate", status: { not: "succeeded" } } }) : null;
  return Object.assign(sub, { intentId: intent?.id ?? null });
}

export type ApplyInput = {
  appId: string;
  planVersionId: string;
  expectedPriceJpy: number;
  mode: "trial" | "start";
  idempotencyKey: string;
  agreed: boolean;
  contactNote?: string;
  payment?: "invoice" | "card" | "starpay";
};

export async function applyForApp(s: SessionUser, input: ApplyInput) {
  if (!s.tenantId) throw new BizError("no_tenant", "利用する空間を選択してください。");
  if (!s.isOwner) throw new BizError("not_owner", "お申し込みは空間のオーナーのみ可能です。");
  if (!input.agreed) throw new BizError("terms", "利用規約への同意が必要です。");
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(input.idempotencyKey)) throw new BizError("bad_key", "不正なリクエストです。");

  const prior = await prisma.applicationRequest.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { subscription: true } });
  if (prior) {
    if (prior.tenantId !== s.tenantId) throw new BizError("bad_key", "不正なリクエストです。");
    return withIntent(prior.subscription);
  }

  const app = await prisma.app.findUnique({ where: { id: input.appId } });
  if (!app || app.status !== "published") throw new BizError("not_found", "アプリが見つかりません。");
  if (!app.acceptingNew) throw new BizError("closed", "このアプリは新規受付を停止しています。");
  if (app.suspendedReason) throw new BizError("suspended", "このアプリは現在一時停止中です。");
  const plan = await prisma.planVersion.findUnique({ where: { id: input.planVersionId } });
  if (!plan || plan.appId !== app.id) throw new BizError("not_found", "プランが見つかりません。");
  // 价格版本重新核对：价格变化时返回确认，不默默提交新价格
  if (!plan.current || plan.priceJpy !== input.expectedPriceJpy) {
    throw new BizError("price_changed", "料金プランが更新されました。最新の内容を確認してから再度お申し込みください。");
  }

  let kind: "trial" | "free" | "paid";
  if (input.mode === "trial") {
    if (plan.trialDays <= 0 || plan.priceType === "free") throw new BizError("no_trial", "このプランには無料体験がありません。");
    kind = "trial";
  } else kind = plan.priceType === "free" ? "free" : "paid";

  const now = new Date();
  const internalTest = app.internalTest || s.tenantId === config.operatorTenantId;
  try {
    return await prisma.$transaction(async (tx) => {
      if (kind === "trial") {
        try {
          await tx.trialUsage.create({ data: { tenantId: s.tenantId!, appId: app.id } });
        } catch (e) {
          if (isUnique(e)) throw new BizError("trial_used", "この空間ではすでに無料体験を利用済みです。");
          throw e;
        }
      }
      const status = kind === "paid" ? "pending" : kind === "trial" ? "trialing" : "active";
      const sub = await tx.subscription.create({
        data: {
          tenantId: s.tenantId!,
          tenantName: s.tenantName ?? "",
          appId: app.id,
          planVersionId: plan.id,
          kind,
          status,
          liveKey: liveKey(s.tenantId!, app.id),
          priceJpySnapshot: kind === "trial" ? 0 : plan.priceJpy,
          planNameSnapshot: plan.name,
          startedAt: kind === "paid" ? null : now,
          trialEndsAt: kind === "trial" ? addDays(now, plan.trialDays) : null,
          currentPeriodStart: kind === "paid" ? null : now,
          currentPeriodEnd: kind === "trial" ? addDays(now, plan.trialDays) : null,
          internalTest,
          paymentMode: kind === "paid" && (input.payment === "card" || input.payment === "starpay") ? input.payment : "invoice",
          createdBy: s.userId,
        },
      });
      if (kind === "paid" && input.payment === "starpay") {
        if (plan.priceType !== "monthly") throw new BizError("contact", "このプランは StarPay 合算に対応していません。");
        if (!(await tx.starpayLink.findUnique({ where: { tenantId: s.tenantId! } }))) throw new BizError("no_starpay", "この空間は StarPay と連携していません。請求・お支払いで加盟店番号を連携してください。");
      }
      if (kind === "paid" && input.payment === "card") {
        if (plan.priceType !== "monthly") throw new BizError("contact", "このプランはカード払いに対応していません。");
        await tx.paymentIntent.create({ data: { tenantId: sub.tenantId, subscriptionId: sub.id, purpose: "activate", planVersionId: plan.id, amountJpy: plan.priceJpy, idempotencyKey: `activate:${sub.id}`, createdBy: s.userId } });
      }
      await tx.applicationRequest.create({
        data: {
          subscriptionId: sub.id,
          tenantId: s.tenantId!,
          requestedBy: s.userId,
          requestedByName: s.userName,
          idempotencyKey: input.idempotencyKey,
          termsVersion: config.termsVersion,
          agreedAt: now,
          contactNote: input.contactNote?.slice(0, 2000) || null,
        },
      });
      if (kind !== "paid") {
        await tx.subscriptionPeriod.create({ data: { subscriptionId: sub.id, kind, startsAt: now, endsAt: sub.currentPeriodEnd } });
      }
      await audit(tx, { actorId: s.userId, actorType: "user", tenantId: s.tenantId, objectType: "subscription", objectId: sub.id, action: `apply_${kind}`, toState: status, data: { planVersionId: plan.id, price: plan.priceJpy, payment: input.payment ?? "invoice" } });
      const evType = kind === "trial" ? "subscription.trial_started" : kind === "free" ? "subscription.activated" : input.payment === "card" || input.payment === "starpay" ? null : "application.submitted";
      if (evType) await emitSubscriptionEvent(tx, evType, sub.id);
      // StarPay 合算：StarPay の請求に載せるため、申込時点で利用開始（初回の請求は合算請求待ち）
      if (kind === "paid" && input.payment === "starpay") {
        return grantPaidPeriod(tx, sub, { start: now, planVersionId: plan.id, planName: plan.name, amountJpy: plan.priceJpy, receiptRef: null, actorId: s.userId, actorType: "user", action: "starpay_activate", autoRenew: true, paymentMode: "starpay", starpay: true });
      }
      return sub;
    }).then(withIntent);
  } catch (e) {
    if (isUnique(e, "liveKey")) throw new BizError("exists", "この空間ではすでにお申し込み済み、または利用中です。");
    if (isUnique(e, "idempotencyKey")) {
      const again = await prisma.applicationRequest.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { subscription: true } });
      if (again) return withIntent(again.subscription);
    }
    throw e;
  }
}

async function ownSub(s: SessionUser, id: string) {
  if (!s.tenantId) throw new BizError("no_tenant", "空間が選択されていません。");
  // 任何 ID 查询都带租户授权范围
  const sub = await prisma.subscription.findFirst({ where: { id, tenantId: s.tenantId } });
  if (!sub) throw new BizError("not_found", "契約が見つかりません。");
  if (!s.isOwner) throw new BizError("not_owner", "この操作は空間のオーナーのみ可能です。");
  return sub;
}

async function transition(
  sub: Subscription,
  from: string[],
  data: Prisma.SubscriptionUpdateInput,
  actor: { id: string; type: "user" | "operator" | "system" },
  action: string,
  reason?: string,
) {
  return prisma.$transaction(async (tx) => {
    // 条件更新实现乐观并发：状态已被其他请求改变则不重复执行
    const r = await tx.subscription.updateMany({ where: { id: sub.id, status: { in: from } }, data: data as Prisma.SubscriptionUpdateManyMutationInput });
    if (r.count === 0) throw new BizError("state", "状態が変更されています。画面を更新してください。");
    const after = await tx.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    await audit(tx, { actorId: actor.id, actorType: actor.type, tenantId: sub.tenantId, objectType: "subscription", objectId: sub.id, action, fromState: sub.status, toState: after.status, reason });
    const ev = ACTION_EVENTS[action];
    if (ev) await emitSubscriptionEvent(tx, typeof ev === "function" ? ev(after.status) : ev, sub.id, { reason: reason ?? null });
    return after;
  });
}

const ended = (status: string) => ({ status, liveKey: null, endedAt: new Date() });

export async function withdrawApplication(s: SessionUser, id: string) {
  const sub = await ownSub(s, id);
  return transition(sub, ["pending"], ended("withdrawn"), { id: s.userId, type: "user" }, "withdraw");
}

export async function endTrialNow(s: SessionUser, id: string) {
  const sub = await ownSub(s, id);
  return transition(sub, ["trialing"], { ...ended("canceled"), trialEndsAt: new Date(), currentPeriodEnd: new Date() }, { id: s.userId, type: "user" }, "end_trial");
}

/** 免费应用停止立即生效；付费退订在本期末生效。 */
export async function cancelSubscription(s: SessionUser, id: string) {
  const sub = await ownSub(s, id);
  if (sub.kind === "free") return transition(sub, ["active"], ended("canceled"), { id: s.userId, type: "user" }, "cancel_free");
  if (sub.kind === "paid") return transition(sub, ["active"], { status: "cancel_scheduled", cancelAt: sub.currentPeriodEnd }, { id: s.userId, type: "user" }, "cancel_at_period_end");
  throw new BizError("state", "この契約は解約できません。");
}

export async function undoCancel(s: SessionUser, id: string) {
  const sub = await ownSub(s, id);
  if (!sub.cancelAt || sub.cancelAt <= new Date()) throw new BizError("state", "解約日を過ぎているため取り消せません。");
  return transition(sub, ["cancel_scheduled"], { status: "active", cancelAt: null }, { id: s.userId, type: "user" }, "undo_cancel");
}

// ---------- 运营操作 ----------
type Op = { userId: string };

export async function rejectApplication(op: Op, id: string, reason: string) {
  const sub = await prisma.subscription.findUniqueOrThrow({ where: { id } });
  await prisma.applicationRequest.update({ where: { subscriptionId: id }, data: { operatorNote: reason, decidedBy: op.userId, decidedAt: new Date() } });
  return transition(sub, ["pending"], ended("rejected"), { id: op.userId, type: "operator" }, "reject", reason);
}

type Tx = Prisma.TransactionClient;

/**
 * 授予一个已付周期（人工确认收款、在线支付、自动续费共用）。
 * 条件更新 + BillingRecord.receiptRef 唯一约束保证同一凭证不会重复延长。
 */
async function grantPaidPeriod(
  tx: Tx,
  sub: Subscription,
  g: { start: Date; planVersionId: string; planName: string; amountJpy: number; receiptRef: string | null; actorId: string; actorType: "operator" | "user" | "system"; action: string; note?: string; paymentMethodId?: string | null; autoRenew?: boolean; paymentMode?: string; starpay?: boolean },
) {
  const end = addOneMonthJst(g.start);
  const fresh = sub.status !== "active" && sub.status !== "cancel_scheduled" && sub.status !== "suspended";
  const r = await tx.subscription.updateMany({
    where: { id: sub.id, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd, planVersionId: sub.planVersionId },
    data: {
      kind: "paid",
      planVersionId: g.planVersionId,
      planNameSnapshot: g.planName,
      priceJpySnapshot: g.amountJpy,
      scheduledPlanVersionId: null,
      lastChargeError: null,
      currentPeriodEnd: end,
      ...(fresh ? { status: "active", startedAt: sub.startedAt && sub.kind !== "trial" ? sub.startedAt : g.start, currentPeriodStart: g.start } : {}),
      ...(sub.status === "cancel_scheduled" ? { status: "active", cancelAt: null } : {}),
      ...(!fresh && sub.kind !== "paid" ? { currentPeriodStart: g.start } : {}),
      ...(g.paymentMethodId !== undefined ? { paymentMethodId: g.paymentMethodId } : {}),
      ...(g.autoRenew !== undefined ? { autoRenew: g.autoRenew } : {}),
      ...(g.paymentMode ? { paymentMode: g.paymentMode } : {}),
    },
  });
  if (r.count === 0) throw new BizError("state", "状態が変更されています。画面を更新してください。");
  // StarPay 合算：期間は付与し、請求は「合算請求待ち」で記録（StarPay の回収確認で入金済みになる）
  const bill = await tx.billingRecord.create({
    data: g.starpay
      ? { tenantId: sub.tenantId, subscriptionId: sub.id, amountJpy: g.amountJpy, status: "due", channel: "starpay", periodStart: g.start, periodEnd: end, note: g.note || null }
      : { tenantId: sub.tenantId, subscriptionId: sub.id, amountJpy: g.amountJpy, status: "paid", periodStart: g.start, periodEnd: end, receiptRef: g.receiptRef, paidAmountJpy: g.amountJpy, paidAt: new Date(), confirmedBy: g.actorId, note: g.note || null },
  });
  await tx.subscriptionPeriod.create({ data: { subscriptionId: sub.id, kind: "paid", startsAt: g.start, endsAt: end, billingRecordId: bill.id } });
  if (sub.status === "pending") await tx.applicationRequest.updateMany({ where: { subscriptionId: sub.id }, data: { decidedBy: g.actorId, decidedAt: new Date() } });
  const after = await tx.subscription.findUniqueOrThrow({ where: { id: sub.id } });
  await audit(tx, { actorId: g.actorId, actorType: g.actorType, tenantId: sub.tenantId, objectType: "subscription", objectId: sub.id, action: g.action, fromState: sub.status, toState: after.status, data: { receiptRef: g.receiptRef, amountJpy: g.amountJpy, planVersionId: g.planVersionId, periodStart: g.start.toISOString(), periodEnd: end.toISOString() } });
  const lifecycle = /renew$/.test(g.action) ? "subscription.renewed" : /upgrade$/.test(g.action) ? "subscription.plan_changed" : "subscription.activated";
  await emitSubscriptionEvent(tx, lifecycle, sub.id);
  if (!g.starpay) await emitSubscriptionEvent(tx, "payment.succeeded", sub.id, { amountJpy: g.amountJpy }, `payment:${g.receiptRef}`);
  return after;
}

/** 下一次收款对应的套餐与金额：试用转换/期末变更优先使用 scheduledPlan。 */
export async function nextCharge(sub: Subscription) {
  const planId = sub.scheduledPlanVersionId ?? sub.planVersionId;
  const plan = await prisma.planVersion.findUniqueOrThrow({ where: { id: planId } });
  const amount = sub.status === "pending" && !sub.scheduledPlanVersionId ? sub.priceJpySnapshot : plan.priceJpy;
  return { plan, amount };
}

/** 确认付款：必须填写外部凭证及金额；同一凭证重复确认不重复延长（唯一约束 + 幂等返回）。 */
export async function confirmPayment(op: Op, id: string, receiptRef: string, amountJpy: number, note?: string) {
  receiptRef = receiptRef.trim();
  if (!receiptRef) throw new BizError("receipt", "外部の入金証憑番号を入力してください。");
  const existing = await prisma.billingRecord.findUnique({ where: { receiptRef } });
  if (existing) {
    if (existing.subscriptionId === id) return { duplicated: true as const, sub: await prisma.subscription.findUniqueOrThrow({ where: { id } }) };
    throw new BizError("receipt_used", "この証憑番号は別の契約で使用済みです。");
  }
  const sub = await prisma.subscription.findUniqueOrThrow({ where: { id } });
  const converting = sub.status === "trialing" && !!sub.scheduledPlanVersionId;
  if (sub.kind !== "paid" && !converting) throw new BizError("state", "有料契約ではありません。");
  const { plan, amount } = await nextCharge(sub);
  if (plan.priceType !== "monthly") throw new BizError("state", "次の期間は有料プランではありません（無料プランへ変更予定）。");
  if (amountJpy !== amount) throw new BizError("amount", `入金額が契約金額（¥${amount.toLocaleString()}）と一致しません。`);

  let start: Date;
  let action: string;
  if (sub.status === "pending" || converting) {
    start = new Date();
    action = converting ? "confirm_payment_convert_trial" : "confirm_payment_activate";
  } else if (["active", "cancel_scheduled", "suspended"].includes(sub.status) && sub.currentPeriodEnd) {
    // 续期：起点为本期结束时间，不缩短已付权益
    start = sub.currentPeriodEnd;
    action = "confirm_payment_renew";
  } else throw new BizError("state", "この状態の契約には入金確認できません。");

  try {
    const after = await prisma.$transaction((tx) =>
      grantPaidPeriod(tx, sub, { start, planVersionId: plan.id, planName: plan.name, amountJpy: amount, receiptRef, actorId: op.userId, actorType: "operator", action, note }),
    );
    return { duplicated: false as const, sub: after };
  } catch (e) {
    if (isUnique(e)) return { duplicated: true as const, sub: await prisma.subscription.findUniqueOrThrow({ where: { id } }) };
    throw e;
  }
}

// ---------- P1：套餐自助变更、试用转付费 ----------

async function ownerSub(s: SessionUser, id: string) {
  const sub = await ownSub(s, id);
  return sub;
}

async function targetPlan(appId: string, planVersionId: string, expectedPriceJpy: number) {
  const plan = await prisma.planVersion.findUnique({ where: { id: planVersionId } });
  if (!plan || plan.appId !== appId) throw new BizError("not_found", "プランが見つかりません。");
  if (!plan.current || plan.priceJpy !== expectedPriceJpy) throw new BizError("price_changed", "料金プランが更新されました。最新の内容を確認してください。");
  if (plan.priceType === "contact") throw new BizError("contact", "このプランはお問い合わせが必要です。");
  return plan;
}

async function createIntent(tx: Tx, sub: Subscription, purpose: string, plan: { id: string; priceJpy: number }, userId: string, key?: string) {
  return tx.paymentIntent.create({
    data: { tenantId: sub.tenantId, subscriptionId: sub.id, purpose, planVersionId: plan.id, amountJpy: plan.priceJpy, idempotencyKey: key ?? `${purpose}:${sub.id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, createdBy: userId },
  });
}

/**
 * 套餐变更：
 * - 付费 → 其他付费/免费：本期末生效（不日割），可取消。
 * - 免费 → 付费：在线支付成功后立即生效（返回 intent）。
 * - 试用 → 付费：在线支付立即开始，或请求书払い等待运营确认（体验期间内）。
 */
export async function changePlan(s: SessionUser, id: string, planVersionId: string, expectedPriceJpy: number, payment: "card" | "invoice") {
  const sub = await ownerSub(s, id);
  const app = await prisma.app.findUniqueOrThrow({ where: { id: sub.appId } });
  if (!app.acceptingNew && sub.status !== "active") throw new BizError("closed", "新規受付を停止しています。");
  const plan = await targetPlan(sub.appId, planVersionId, expectedPriceJpy);
  if (plan.id === sub.planVersionId && sub.status !== "trialing") throw new BizError("same", "現在と同じプランです。");

  if (sub.status === "active" && sub.kind === "paid") {
    const r = await prisma.subscription.updateMany({ where: { id, status: "active", kind: "paid" }, data: { scheduledPlanVersionId: plan.id } });
    if (!r.count) throw new BizError("state", "状態が変更されています。");
    await audit(prisma, { actorId: s.userId, actorType: "user", tenantId: sub.tenantId, objectType: "subscription", objectId: id, action: "schedule_plan_change", data: { to: plan.id, price: plan.priceJpy } });
    await emitSubscriptionEvent(prisma, "subscription.plan_change_scheduled", id);
    return { scheduled: true as const };
  }
  if (plan.priceType !== "monthly") throw new BizError("state", "このプランには変更できません。");
  if (sub.status === "active" && sub.kind === "free") {
    if (payment !== "card") throw new BizError("card_only", "無料プランからの変更はカード払いのみ対応しています。請求書払いはお問い合わせください。");
    const intent = await prisma.$transaction((tx) => createIntent(tx, sub, "upgrade", plan, s.userId));
    return { intentId: intent.id };
  }
  if (sub.status === "trialing") {
    await prisma.subscription.update({ where: { id }, data: { scheduledPlanVersionId: plan.id } });
    await audit(prisma, { actorId: s.userId, actorType: "user", tenantId: sub.tenantId, objectType: "subscription", objectId: id, action: payment === "card" ? "convert_trial_card" : "convert_trial_request", data: { to: plan.id } });
    if (payment === "card") {
      const intent = await prisma.$transaction((tx) => createIntent(tx, sub, "convert_trial", plan, s.userId));
      return { intentId: intent.id };
    }
    return { requested: true as const };
  }
  throw new BizError("state", "この契約ではプランを変更できません。");
}

export async function cancelPlanChange(s: SessionUser, id: string) {
  const sub = await ownerSub(s, id);
  if (!sub.scheduledPlanVersionId) throw new BizError("state", "予定されている変更はありません。");
  await prisma.subscription.update({ where: { id }, data: { scheduledPlanVersionId: null } });
  await prisma.paymentIntent.updateMany({ where: { subscriptionId: id, status: { in: ["requires_payment", "failed"] }, purpose: { in: ["convert_trial", "upgrade"] } }, data: { status: "canceled" } });
  await audit(prisma, { actorId: s.userId, actorType: "user", tenantId: sub.tenantId, objectType: "subscription", objectId: id, action: "cancel_plan_change" });
}

export async function setAutoRenew(s: SessionUser, id: string, on: boolean, paymentMethodId?: string) {
  const sub = await ownerSub(s, id);
  if (sub.kind !== "paid") throw new BizError("state", "有料契約ではありません。");
  if (on) {
    const pm = paymentMethodId ? await prisma.paymentMethod.findFirst({ where: { id: paymentMethodId, tenantId: sub.tenantId, active: true } }) : null;
    if (!pm) throw new BizError("no_card", "自動更新にはカードの登録が必要です。");
    await prisma.subscription.update({ where: { id }, data: { autoRenew: true, paymentMethodId: pm.id, paymentMode: "card", lastChargeError: null } });
  } else {
    await prisma.subscription.update({ where: { id }, data: { autoRenew: false } });
  }
  await audit(prisma, { actorId: s.userId, actorType: "user", tenantId: sub.tenantId, objectType: "subscription", objectId: id, action: on ? "auto_renew_on" : "auto_renew_off" });
}

export async function setUsageCap(s: SessionUser, id: string, capJpy: number | null) {
  const sub = await ownerSub(s, id);
  if (capJpy !== null && !(capJpy >= 0 && capJpy <= 10_000_000)) throw new BizError("cap", "上限額が不正です。");
  await prisma.subscription.update({ where: { id }, data: { usageCapJpy: capJpy } });
  await audit(prisma, { actorId: s.userId, actorType: "user", tenantId: sub.tenantId, objectType: "subscription", objectId: id, action: "set_usage_cap", data: { capJpy } });
}

// ---------- P1：在线支付 ----------

export async function addPaymentMethod(s: SessionUser, card: CardInput) {
  if (!s.tenantId || !s.isOwner) throw new BizError("not_owner", "支払い方法の登録は空間のオーナーのみ可能です。");
  const t = await paymentProvider().tokenize(card);
  if (!t.ok) throw new BizError(t.code, t.message);
  const pm = await prisma.paymentMethod.create({ data: { tenantId: s.tenantId, provider: paymentProvider().name, providerRef: t.token, brand: t.brand, last4: t.last4, expMonth: t.expMonth, expYear: t.expYear, createdBy: s.userId } });
  await audit(prisma, { actorId: s.userId, actorType: "user", tenantId: s.tenantId, objectType: "payment_method", objectId: pm.id, action: "add", data: { brand: pm.brand, last4: pm.last4 } });
  return pm;
}

export async function removePaymentMethod(s: SessionUser, id: string) {
  if (!s.tenantId || !s.isOwner) throw new BizError("not_owner", "オーナーのみ操作できます。");
  const pm = await prisma.paymentMethod.findFirst({ where: { id, tenantId: s.tenantId, active: true } });
  if (!pm) throw new BizError("not_found", "支払い方法が見つかりません。");
  const using = await prisma.subscription.count({ where: { paymentMethodId: id, autoRenew: true, liveKey: { not: null } } });
  if (using) throw new BizError("in_use", `自動更新中の契約（${using}件）で使用中です。先に別のカードへ変更するか自動更新を停止してください。`);
  await prisma.paymentMethod.update({ where: { id }, data: { active: false } });
  await audit(prisma, { actorId: s.userId, actorType: "user", tenantId: s.tenantId, objectType: "payment_method", objectId: id, action: "remove" });
}

/** 支付一个 intent（开通 / 试用转付费 / 免费升级）。成功后立即授予已付周期。 */
export async function payIntent(s: SessionUser, intentId: string, p: { paymentMethodId?: string; card?: CardInput; autoRenew: boolean }) {
  if (!s.tenantId || !s.isOwner) throw new BizError("not_owner", "お支払いは空間のオーナーのみ可能です。");
  const intent = await prisma.paymentIntent.findFirst({ where: { id: intentId, tenantId: s.tenantId }, include: { plan: true, subscription: true } });
  if (!intent) throw new BizError("not_found", "お支払い情報が見つかりません。");
  if (intent.status === "succeeded") return intent.subscription;
  if (!["requires_payment", "failed"].includes(intent.status)) throw new BizError("state", "このお支払いは無効になっています。");
  if (!intent.plan.current || intent.plan.priceJpy !== intent.amountJpy) throw new BizError("price_changed", "料金プランが更新されました。もう一度お申し込みください。");

  let pm = p.paymentMethodId ? await prisma.paymentMethod.findFirst({ where: { id: p.paymentMethodId, tenantId: s.tenantId, active: true } }) : null;
  if (!pm && p.card) pm = await addPaymentMethod(s, p.card);
  if (!pm) throw new BizError("no_card", "支払い方法を選択してください。");

  // 防并发重复扣款：先把 intent 置为 processing（条件更新）
  const lock = await prisma.paymentIntent.updateMany({ where: { id: intent.id, status: { in: ["requires_payment", "failed"] } }, data: { status: "processing", attempts: { increment: 1 }, paymentMethodId: pm.id } });
  if (!lock.count) throw new BizError("state", "お支払いを処理中です。しばらくしてから画面を更新してください。");
  const res = await paymentProvider().charge(pm.providerRef, intent.amountJpy, `${intent.id}:${intent.attempts + 1}`);
  if (!res.ok) {
    await prisma.paymentIntent.update({ where: { id: intent.id }, data: { status: "failed", failureReason: res.message } });
    await audit(prisma, { actorId: s.userId, actorType: "user", tenantId: s.tenantId, objectType: "payment_intent", objectId: intent.id, action: "charge_failed", reason: res.code });
    throw new BizError(res.code, res.message);
  }
  return settleIntent(intent.id, res.chargeId, { actorId: s.userId, actorType: "user", autoRenew: p.autoRenew });
}

/** 收款成功后的结算（也可由服务商 webhook 调用）。 */
export async function settleIntent(intentId: string, chargeId: string, a: { actorId: string; actorType: "user" | "system"; autoRenew?: boolean }) {
  return prisma.$transaction(async (tx) => {
    const intent = await tx.paymentIntent.findUniqueOrThrow({ where: { id: intentId }, include: { plan: true } });
    if (intent.status === "succeeded") return tx.subscription.findUniqueOrThrow({ where: { id: intent.subscriptionId } });
    await tx.paymentIntent.update({ where: { id: intentId }, data: { status: "succeeded", providerChargeId: chargeId, failureReason: null } });
    const sub = await tx.subscription.findUniqueOrThrow({ where: { id: intent.subscriptionId } });
    const okStates: Record<string, string[]> = { activate: ["pending"], convert_trial: ["trialing"], upgrade: ["active"], renew: ["active", "suspended"] };
    if (!okStates[intent.purpose]?.includes(sub.status)) throw new BizError("state", "契約の状態が変わったため、お支払いを反映できませんでした。運営にお問い合わせください。");
    const start = intent.purpose === "renew" && sub.currentPeriodEnd ? sub.currentPeriodEnd : new Date();
    return grantPaidPeriod(tx, sub, {
      start, planVersionId: intent.planVersionId, planName: intent.plan.name, amountJpy: intent.amountJpy, receiptRef: chargeId,
      actorId: a.actorId, actorType: a.actorType, action: `card_${intent.purpose}`,
      paymentMethodId: intent.paymentMethodId, paymentMode: "card", ...(a.autoRenew !== undefined ? { autoRenew: a.autoRenew } : {}),
    });
  });
}

/** 定时任务：期末降级为免费套餐。 */
export async function applyScheduledDowngrades(now = new Date()) {
  const due = await prisma.subscription.findMany({ where: { status: "active", kind: "paid", currentPeriodEnd: { lte: now }, scheduledPlan: { priceType: "free" } }, include: { scheduledPlan: true } });
  let n = 0;
  for (const sub of due) {
    const plan = sub.scheduledPlan!;
    await prisma.$transaction(async (tx) => {
      const r = await tx.subscription.updateMany({ where: { id: sub.id, status: "active", scheduledPlanVersionId: plan.id }, data: { kind: "free", planVersionId: plan.id, planNameSnapshot: plan.name, priceJpySnapshot: 0, scheduledPlanVersionId: null, currentPeriodStart: sub.currentPeriodEnd, currentPeriodEnd: null, autoRenew: false } });
      if (!r.count) return;
      await tx.subscriptionPeriod.create({ data: { subscriptionId: sub.id, kind: "free", startsAt: sub.currentPeriodEnd! } });
      await audit(tx, { actorId: "system", actorType: "system", tenantId: sub.tenantId, objectType: "subscription", objectId: sub.id, action: "downgrade_to_free", fromState: "active", toState: "active" });
      await emitSubscriptionEvent(tx, "subscription.plan_changed", sub.id);
      n++;
    });
  }
  return n;
}

/** 定时任务：自动续费。期末前 24 小时起扣款，失败最多重试 3 次（间隔 ≥6 小时）；未付则期末按规则到期。 */
/** StarPay 合算の自動更新：期間を延長し、次の請求を合算請求待ちで記録（冪等：期間終了時刻の条件付き更新と請求の一意制約）。 */
async function renewStarpay(now: Date) {
  const due = await prisma.subscription.findMany({
    where: { status: "active", kind: "paid", autoRenew: true, paymentMode: "starpay", currentPeriodEnd: { lte: new Date(now.getTime() + 86400000), gt: new Date(now.getTime() - 3 * 86400000) } },
    include: { scheduledPlan: true, plan: true },
  });
  let renewed = 0;
  for (const sub of due) {
    const plan = sub.scheduledPlan ?? sub.plan;
    if (plan.priceType !== "monthly") continue;
    if (!(await prisma.starpayLink.findUnique({ where: { tenantId: sub.tenantId } }))) continue;
    try {
      await prisma.$transaction((tx) => grantPaidPeriod(tx, sub, { start: sub.currentPeriodEnd!, planVersionId: plan.id, planName: plan.name, amountJpy: plan.priceJpy, receiptRef: null, actorId: "system", actorType: "system", action: "starpay_renew", starpay: true }));
      renewed++;
    } catch (e) {
      if (e instanceof BizError || isUnique(e)) continue;
      throw e;
    }
  }
  return renewed;
}

export async function renewDue(now = new Date()) {
  const due = await prisma.subscription.findMany({
    where: { status: "active", kind: "paid", autoRenew: true, paymentMethodId: { not: null }, currentPeriodEnd: { lte: new Date(now.getTime() + 86400000), gt: new Date(now.getTime() - 3 * 86400000) } },
    include: { paymentMethod: true, scheduledPlan: true, plan: true },
  });
  const out = { charged: 0, failed: 0, skipped: 0, starpay: await renewStarpay(now) };
  for (const sub of due) {
    const plan = sub.scheduledPlan ?? sub.plan;
    if (plan.priceType !== "monthly" || !sub.paymentMethod?.active) { out.skipped++; continue; }
    const key = `renew:${sub.id}:${sub.currentPeriodEnd!.toISOString()}`;
    let intent = await prisma.paymentIntent.findUnique({ where: { idempotencyKey: key } });
    if (!intent) {
      try {
        intent = await prisma.paymentIntent.create({ data: { tenantId: sub.tenantId, subscriptionId: sub.id, purpose: "renew", planVersionId: plan.id, amountJpy: plan.priceJpy, paymentMethodId: sub.paymentMethodId, idempotencyKey: key, createdBy: "system" } });
      } catch (e) {
        if (isUnique(e)) { out.skipped++; continue; }
        throw e;
      }
    }
    if (intent.status === "succeeded" || intent.status === "processing" || intent.attempts >= 3) { out.skipped++; continue; }
    if (intent.status === "failed" && now.getTime() - intent.updatedAt.getTime() < 6 * 3600000) { out.skipped++; continue; }
    const lock = await prisma.paymentIntent.updateMany({ where: { id: intent.id, status: { in: ["requires_payment", "failed"] } }, data: { status: "processing", attempts: { increment: 1 } } });
    if (!lock.count) { out.skipped++; continue; }
    const res = await paymentProvider().charge(sub.paymentMethod.providerRef, intent.amountJpy, `${intent.id}:${intent.attempts + 1}`);
    if (res.ok) {
      try { await settleIntent(intent.id, res.chargeId, { actorId: "system", actorType: "system" }); out.charged++; }
      catch (e) { await prisma.paymentIntent.update({ where: { id: intent.id }, data: { status: "failed", failureReason: String(e) } }); out.failed++; }
    } else {
      await prisma.paymentIntent.update({ where: { id: intent.id }, data: { status: "failed", failureReason: res.message } });
      await prisma.subscription.update({ where: { id: sub.id }, data: { lastChargeError: `${res.message}（${intent.attempts + 1}/3 回目）` } });
      await audit(prisma, { actorId: "system", actorType: "system", tenantId: sub.tenantId, objectType: "subscription", objectId: sub.id, action: "renew_charge_failed", reason: res.code });
      await emitSubscriptionEvent(prisma, "payment.failed", sub.id, { reason: res.message, amountJpy: intent.amountJpy }, `payment_failed:${intent.id}:${intent.attempts + 1}`);
      out.failed++;
    }
  }
  return out;
}


export async function suspendSubscription(op: Op, id: string, reason: string) {
  if (!reason.trim()) throw new BizError("reason", "停止理由を入力してください。");
  const sub = await prisma.subscription.findUniqueOrThrow({ where: { id } });
  return transition(sub, ["trialing", "active", "cancel_scheduled"], { status: "suspended", statusBeforeSuspend: sub.status, suspendedReason: reason }, { id: op.userId, type: "operator" }, "suspend", reason);
}

export async function resumeSubscription(op: Op, id: string) {
  const sub = await prisma.subscription.findUniqueOrThrow({ where: { id } });
  return transition(sub, ["suspended"], { status: sub.statusBeforeSuspend ?? "active", statusBeforeSuspend: null, suspendedReason: null }, { id: op.userId, type: "operator" }, "resume");
}

export async function operatorCancelAtPeriodEnd(op: Op, id: string, reason: string) {
  const sub = await prisma.subscription.findUniqueOrThrow({ where: { id } });
  if (sub.kind !== "paid") return transition(sub, ["active", "trialing"], ended("canceled"), { id: op.userId, type: "operator" }, "operator_cancel", reason);
  return transition(sub, ["active"], { status: "cancel_scheduled", cancelAt: sub.currentPeriodEnd }, { id: op.userId, type: "operator" }, "operator_cancel_at_period_end", reason);
}

/** 定时任务：到期处理（幂等，条件更新保证多副本不重复）。 */
export async function expireDue(now = new Date()) {
  let n = 0;
  const due = await prisma.subscription.findMany({
    where: {
      OR: [
        { status: "trialing", trialEndsAt: { lte: now } },
        { status: "active", kind: "paid", currentPeriodEnd: { lte: now } },
        { status: "cancel_scheduled", cancelAt: { lte: now } },
        { status: "suspended", kind: { in: ["paid", "trial"] }, currentPeriodEnd: { lte: now } },
      ],
    },
  });
  for (const sub of due) {
    const to = sub.status === "cancel_scheduled" ? "canceled" : "expired";
    try {
      await transition(sub, [sub.status], ended(to), { id: "system", type: "system" }, "period_end");
      n++;
    } catch (e) {
      if (!(e instanceof BizError)) throw e;
    }
  }
  return n;
}
