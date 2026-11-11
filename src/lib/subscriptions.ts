import { Prisma, type Subscription } from "@prisma/client";
import { prisma } from "./db";
import { audit } from "./audit";
import { addDays, addOneMonthJst } from "./time";
import { config } from "./config";
import type { SessionUser } from "./session";

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

export type ApplyInput = {
  appId: string;
  planVersionId: string;
  expectedPriceJpy: number;
  mode: "trial" | "start";
  idempotencyKey: string;
  agreed: boolean;
  contactNote?: string;
};

export async function applyForApp(s: SessionUser, input: ApplyInput) {
  if (!s.tenantId) throw new BizError("no_tenant", "利用する空間を選択してください。");
  if (!s.isOwner) throw new BizError("not_owner", "お申し込みは空間のオーナーのみ可能です。");
  if (!input.agreed) throw new BizError("terms", "利用規約への同意が必要です。");
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(input.idempotencyKey)) throw new BizError("bad_key", "不正なリクエストです。");

  const prior = await prisma.applicationRequest.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { subscription: true } });
  if (prior) {
    if (prior.tenantId !== s.tenantId) throw new BizError("bad_key", "不正なリクエストです。");
    return prior.subscription;
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
          createdBy: s.userId,
        },
      });
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
      await audit(tx, { actorId: s.userId, actorType: "user", tenantId: s.tenantId, objectType: "subscription", objectId: sub.id, action: `apply_${kind}`, toState: status, data: { planVersionId: plan.id, price: plan.priceJpy } });
      return sub;
    });
  } catch (e) {
    if (isUnique(e, "liveKey")) throw new BizError("exists", "この空間ではすでにお申し込み済み、または利用中です。");
    if (isUnique(e, "idempotencyKey")) {
      const again = await prisma.applicationRequest.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { subscription: true } });
      if (again) return again.subscription;
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
  if (sub.kind !== "paid") throw new BizError("state", "有料契約ではありません。");
  if (amountJpy !== sub.priceJpySnapshot) throw new BizError("amount", `入金額が契約金額（¥${sub.priceJpySnapshot.toLocaleString()}）と一致しません。`);

  const now = new Date();
  let start: Date;
  let from: string[];
  let action: string;
  if (sub.status === "pending") {
    start = now;
    from = ["pending"];
    action = "confirm_payment_activate";
  } else if (["active", "cancel_scheduled", "suspended"].includes(sub.status) && sub.currentPeriodEnd) {
    // 续期：起点为本期结束时间，不缩短已付权益
    start = sub.currentPeriodEnd;
    from = [sub.status];
    action = "confirm_payment_renew";
  } else throw new BizError("state", "この状態の契約には入金確認できません。");
  const end = addOneMonthJst(start);

  try {
    return await prisma.$transaction(async (tx) => {
      const r = await tx.subscription.updateMany({
        where: { id, status: { in: from }, currentPeriodEnd: sub.currentPeriodEnd },
        data:
          sub.status === "pending"
            ? { status: "active", startedAt: now, currentPeriodStart: start, currentPeriodEnd: end }
            : { currentPeriodEnd: end, ...(sub.status === "cancel_scheduled" ? { status: "active", cancelAt: null } : {}) },
      });
      if (r.count === 0) throw new BizError("state", "状態が変更されています。画面を更新してください。");
      const bill = await tx.billingRecord.create({
        data: { tenantId: sub.tenantId, subscriptionId: id, amountJpy: sub.priceJpySnapshot, status: "paid", periodStart: start, periodEnd: end, receiptRef, paidAmountJpy: amountJpy, paidAt: now, confirmedBy: op.userId, note: note || null },
      });
      await tx.subscriptionPeriod.create({ data: { subscriptionId: id, kind: "paid", startsAt: start, endsAt: end, billingRecordId: bill.id } });
      if (sub.status === "pending") await tx.applicationRequest.update({ where: { subscriptionId: id }, data: { decidedBy: op.userId, decidedAt: now } });
      await audit(tx, { actorId: op.userId, actorType: "operator", tenantId: sub.tenantId, objectType: "subscription", objectId: id, action, fromState: sub.status, toState: sub.status === "pending" ? "active" : sub.status === "cancel_scheduled" ? "active" : sub.status, data: { receiptRef, amountJpy, periodStart: start.toISOString(), periodEnd: end.toISOString() } });
      return { duplicated: false as const, sub: await tx.subscription.findUniqueOrThrow({ where: { id } }) };
    });
  } catch (e) {
    if (isUnique(e)) return { duplicated: true as const, sub: await prisma.subscription.findUniqueOrThrow({ where: { id } }) };
    throw e;
  }
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
