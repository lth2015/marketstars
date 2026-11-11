import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { agentSubscribe, authenticateAgent } from "@/lib/agentpay";
import { BizError } from "@/lib/subscriptions";
import { problem } from "@/lib/api";

export async function GET(req: Request) {
  const m = await authenticateAgent(req);
  if (!m) return problem(401, "invalid_agent_key", "agent key invalid, revoked or expired");
  const subs = await prisma.subscription.findMany({ where: { tenantId: m.tenantId, liveKey: { not: null } }, include: { app: { select: { slug: true, name: true } } } });
  return NextResponse.json({ items: subs.map((s) => ({ id: s.id, app: s.app.slug, app_name: s.app.name, status: s.status, plan: s.planNameSnapshot, price_jpy: s.priceJpySnapshot })) });
}

/** 在授权范围内开通应用。拒绝时返回 402 及原因，并记录到代理交易日志。 */
export async function POST(req: Request) {
  const m = await authenticateAgent(req);
  if (!m) return problem(401, "invalid_agent_key", "agent key invalid, revoked or expired");
  const b = (await req.json().catch(() => ({}))) as { app_slug?: string; plan_id?: string; expected_price_jpy?: number; mode?: string; idempotency_key?: string };
  if (!b.app_slug || !b.plan_id || typeof b.expected_price_jpy !== "number" || !b.idempotency_key) return problem(400, "invalid_request", "app_slug, plan_id, expected_price_jpy, idempotency_key are required");
  try {
    const r = await agentSubscribe(m, { appSlug: b.app_slug, planId: b.plan_id, expectedPriceJpy: b.expected_price_jpy, mode: b.mode === "trial" ? "trial" : "start", idempotencyKey: b.idempotency_key });
    const body = { status: r.status, reason: r.reason ?? null, amount_jpy: r.amountJpy, transaction_id: r.transactionId, subscription_id: r.subscriptionId ?? null, subscription_status: r.subscriptionStatus ?? null };
    return NextResponse.json(body, { status: r.status === "approved" ? 201 : r.status === "denied" ? 402 : 409 });
  } catch (e) {
    if (e instanceof BizError) return problem(400, e.code, e.message);
    throw e;
  }
}
