import { NextResponse } from "next/server";
import { authenticateAppClient, problem } from "@/lib/api";
import { isEntitled, liveSubscription } from "@/lib/subscriptions";

/** 接入应用在每次使用付费能力前校验租户权益（MarketStars 为权威）。 */
export async function POST(req: Request) {
  const app = await authenticateAppClient(req);
  if (!app) return problem(401, "invalid_client", "client authentication failed");
  const body = (await req.json().catch(() => ({}))) as { tenant_id?: string };
  if (!body.tenant_id) return problem(400, "invalid_request", "tenant_id is required");
  const sub = await liveSubscription(body.tenant_id, app.id);
  const entitled = !!sub && isEntitled(sub) && !app.suspendedReason;
  return NextResponse.json({ entitled, status: sub?.status ?? "none", kind: sub?.kind ?? null, plan_key: sub?.plan.planKey ?? null, expires_at: sub ? (sub.status === "trialing" ? sub.trialEndsAt : sub.cancelAt ?? sub.currentPeriodEnd)?.toISOString() ?? null : null });
}
