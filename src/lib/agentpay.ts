// AgentPay：AI 代理在空间 owner 授予的支付授权（预算/单笔上限/应用范围/有效期）内自动开通应用。
import crypto from "node:crypto";
import type { AgentMandate, Prisma } from "@prisma/client";
import { prisma } from "./db";
import { audit } from "./audit";
import { jstMonth } from "./usage";
import { applyForApp, BizError, payIntent, withdrawApplication } from "./subscriptions";
import type { SessionUser } from "./session";

export const AGENT_SCOPES = { catalog: "アプリの検索・閲覧", subscribe: "アプリの利用開始・購入" } as const;
const hash = (k: string) => crypto.createHash("sha256").update(k).digest("hex");

export async function createMandate(s: SessionUser, m: { name: string; monthlyBudgetJpy: number; perTxLimitJpy: number; allowedAppIds: string[] | null; days: number; scopes: string[] }) {
  if (!s.tenantId || !s.isOwner) throw new BizError("not_owner", "支払い権限の発行は空間のオーナーのみ可能です。");
  const name = m.name.trim().slice(0, 60);
  if (!name) throw new BizError("name", "エージェント名を入力してください。");
  if (!(m.monthlyBudgetJpy >= 0 && m.monthlyBudgetJpy <= 1_000_000)) throw new BizError("budget", "月の予算は 0〜1,000,000 円で指定してください。");
  if (!(m.perTxLimitJpy >= 0 && m.perTxLimitJpy <= m.monthlyBudgetJpy)) throw new BizError("limit", "1回あたりの上限は月の予算以下にしてください。");
  if (!(m.days >= 1 && m.days <= 365)) throw new BizError("days", "有効期間は 1〜365 日で指定してください。");
  const scopes = m.scopes.filter((x) => x in AGENT_SCOPES);
  if (!scopes.length) throw new BizError("scopes", "権限を1つ以上選択してください。");
  const key = `msk_${crypto.randomBytes(24).toString("base64url")}`;
  const row = await prisma.agentMandate.create({
    data: { tenantId: s.tenantId, tenantName: s.tenantName ?? "", name, keyPrefix: key.slice(0, 12), keyHash: hash(key), scopes: scopes.join(","), allowedAppIds: (m.allowedAppIds ?? undefined) as Prisma.InputJsonValue | undefined, monthlyBudgetJpy: m.monthlyBudgetJpy, perTxLimitJpy: m.perTxLimitJpy, expiresAt: new Date(Date.now() + m.days * 86400000), createdBy: s.userId },
  });
  await audit(prisma, { actorId: s.userId, actorType: "user", tenantId: s.tenantId, objectType: "agent_mandate", objectId: row.id, action: "create", data: { budget: m.monthlyBudgetJpy, perTx: m.perTxLimitJpy, scopes } });
  return { mandate: row, key };
}

export async function revokeMandate(s: SessionUser, id: string) {
  if (!s.tenantId || !s.isOwner) throw new BizError("not_owner", "オーナーのみ操作できます。");
  const r = await prisma.agentMandate.updateMany({ where: { id, tenantId: s.tenantId, revokedAt: null }, data: { revokedAt: new Date() } });
  if (r.count) await audit(prisma, { actorId: s.userId, actorType: "user", tenantId: s.tenantId, objectType: "agent_mandate", objectId: id, action: "revoke" });
}

/** Bearer msk_… 认证；已撤销或过期的授权一律拒绝。 */
export async function authenticateAgent(req: Request) {
  const h = req.headers.get("authorization") ?? "";
  if (!h.startsWith("Bearer msk_")) return null;
  const m = await prisma.agentMandate.findUnique({ where: { keyHash: hash(h.slice(7)) } });
  if (!m || m.revokedAt || m.expiresAt <= new Date()) return null;
  await prisma.agentMandate.update({ where: { id: m.id }, data: { lastUsedAt: new Date() } });
  return m;
}

export const hasScope = (m: AgentMandate, s: keyof typeof AGENT_SCOPES) => m.scopes.split(",").includes(s);
export const appAllowed = (m: AgentMandate, appId: string) => !Array.isArray(m.allowedAppIds) || (m.allowedAppIds as string[]).includes(appId);

export async function monthSpend(mandateId: string, month = jstMonth()) {
  const agg = await prisma.agentTransaction.aggregate({ where: { mandateId, status: { in: ["approved", "pending"] }, createdAt: { gte: month.start, lt: month.end } }, _sum: { amountJpy: true } });
  return agg._sum.amountJpy ?? 0;
}

function actorFor(m: AgentMandate): SessionUser {
  // 代理以授权为依据代表 owner 行事；审计中以 agent:<id> 标识
  return { sessionId: `agent-${m.id}`, userId: `agent:${m.id}`, userName: `${m.name}（AIエージェント）`, email: null, tenantId: m.tenantId, tenantName: m.tenantName, isOwner: true, csrfToken: "", authMode: "agent" };
}

export type AgentSubscribeResult = { status: "approved" | "denied" | "failed"; reason?: string; subscriptionId?: string; amountJpy: number; transactionId: string; subscriptionStatus?: string };

export async function agentSubscribe(m: AgentMandate, input: { appSlug: string; planId: string; expectedPriceJpy: number; mode: "trial" | "start"; idempotencyKey: string }): Promise<AgentSubscribeResult> {
  if (!/^[A-Za-z0-9_-]{8,48}$/.test(input.idempotencyKey)) throw new BizError("bad_key", "idempotency_key は英数字・_- の 8〜48 文字にしてください。");
  const prior = await prisma.agentTransaction.findUnique({ where: { mandateId_idempotencyKey: { mandateId: m.id, idempotencyKey: input.idempotencyKey } } });
  if (prior) return { status: prior.status as AgentSubscribeResult["status"], reason: prior.reason ?? undefined, subscriptionId: prior.subscriptionId ?? undefined, amountJpy: prior.amountJpy, transactionId: prior.id };

  const app = await prisma.app.findFirst({ where: { slug: input.appSlug, status: "published" } });
  const plan = app ? await prisma.planVersion.findFirst({ where: { id: input.planId, appId: app.id } }) : null;
  const trial = input.mode === "trial" && !!plan && plan.trialDays > 0 && plan.priceType !== "free";
  const amount = !plan || trial || plan.priceType === "free" ? 0 : plan.priceJpy;

  // 预留：锁住授权行，检查预算后写入 pending 记录（并发请求不会超出预算）
  const reserve = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM AgentMandate WHERE id = ${m.id} FOR UPDATE`;
    let reason: string | null = null;
    if (!hasScope(m, "subscribe")) reason = "この権限ではアプリを購入できません（subscribe スコープなし）。";
    else if (!app || !plan) reason = "アプリまたはプランが見つかりません。";
    else if (!appAllowed(m, app.id)) reason = "このアプリは許可されたアプリに含まれていません。";
    else if (!plan.current || plan.priceJpy !== input.expectedPriceJpy) reason = "料金プランが更新されています。最新の料金で再確認してください。";
    else if (plan.priceType === "contact") reason = "要問い合わせのプランはエージェントから購入できません。";
    else if (amount > m.perTxLimitJpy) reason = `1回あたりの上限（¥${m.perTxLimitJpy.toLocaleString()}）を超えています。`;
    else {
      const month = jstMonth();
      const agg = await tx.agentTransaction.aggregate({ where: { mandateId: m.id, status: { in: ["approved", "pending"] }, createdAt: { gte: month.start, lt: month.end } }, _sum: { amountJpy: true } });
      if ((agg._sum.amountJpy ?? 0) + amount > m.monthlyBudgetJpy) reason = `今月の予算（¥${m.monthlyBudgetJpy.toLocaleString()}）を超えます。`;
    }
    if (!reason && amount > 0) {
      const card = await tx.paymentMethod.findFirst({ where: { tenantId: m.tenantId, active: true } });
      if (!card) reason = "空間に登録済みのカードがありません。";
    }
    const row = await tx.agentTransaction.create({ data: { mandateId: m.id, tenantId: m.tenantId, appId: app?.id ?? null, amountJpy: amount, status: reason ? "denied" : "pending", reason, idempotencyKey: input.idempotencyKey } });
    return { row, reason };
  });
  const base = { amountJpy: amount, transactionId: reserve.row.id };
  if (reserve.reason) {
    await audit(prisma, { actorId: `agent:${m.id}`, actorType: "user", tenantId: m.tenantId, objectType: "agent_transaction", objectId: reserve.row.id, action: "denied", reason: reserve.reason });
    return { status: "denied", reason: reserve.reason, ...base };
  }

  const actor = actorFor(m);
  let subId: string | undefined;
  try {
    const sub = await applyForApp(actor, { appId: app!.id, planVersionId: plan!.id, expectedPriceJpy: plan!.priceJpy, mode: trial ? "trial" : "start", idempotencyKey: `ag-${reserve.row.id}`, agreed: true, payment: amount > 0 ? "card" : "invoice" });
    subId = sub.id;
    if (sub.intentId) {
      const card = await prisma.paymentMethod.findFirstOrThrow({ where: { tenantId: m.tenantId, active: true }, orderBy: { createdAt: "desc" } });
      try {
        await payIntent(actor, sub.intentId, { paymentMethodId: card.id, autoRenew: false });
      } catch (e) {
        await withdrawApplication(actor, sub.id).catch(() => undefined);
        throw e;
      }
    }
  } catch (e) {
    const reason = e instanceof BizError ? e.message : "処理に失敗しました。";
    await prisma.agentTransaction.update({ where: { id: reserve.row.id }, data: { status: "failed", reason, subscriptionId: subId ?? null } });
    return { status: "failed", reason, subscriptionId: subId, ...base };
  }
  const after = await prisma.subscription.findUniqueOrThrow({ where: { id: subId! } });
  await prisma.agentTransaction.update({ where: { id: reserve.row.id }, data: { status: "approved", subscriptionId: subId } });
  return { status: "approved", subscriptionId: subId, subscriptionStatus: after.status, ...base };
}
