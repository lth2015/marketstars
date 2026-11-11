import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { authenticateAppClient, problem } from "@/lib/api";
import { isEntitled, liveSubscription } from "@/lib/subscriptions";
import { hit, LIMITS, tooMany } from "@/lib/ratelimit";

export async function POST(req: Request) {
  const app = await authenticateAppClient(req);
  if (!app) return problem(401, "invalid_client", "client authentication failed");
  const rl = await hit(`launch:${app.id}`, LIMITS.launchExchange);
  if (!rl.ok) return tooMany(rl.retryAfter);
  const body = (await req.json().catch(() => ({}))) as { code?: string };
  if (!body.code) return problem(400, "invalid_request", "code is required");
  const hash = crypto.createHash("sha256").update(body.code).digest("hex");
  // 一次性：条件更新 usedAt，确保并发兑换只有一次成功
  const r = await prisma.launchTicket.updateMany({ where: { codeHash: hash, appId: app.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
  if (r.count !== 1) return problem(400, "invalid_grant", "launch code invalid, expired or used");
  const t = await prisma.launchTicket.findUniqueOrThrow({ where: { codeHash: hash } });
  const sub = await liveSubscription(t.tenantId, app.id);
  const entitled = !!sub && isEntitled(sub) && !app.suspendedReason;
  if (!entitled) return problem(403, "not_entitled", "tenant has no active entitlement");
  return NextResponse.json({ user_id: t.userId, user_name: t.userName, tenant_id: t.tenantId, tenant_name: sub!.tenantName, app: app.slug, entitlement: { status: sub!.status, kind: sub!.kind, plan_key: sub!.plan.planKey, expires_at: (sub!.status === "trialing" ? sub!.trialEndsAt : sub!.cancelAt ?? sub!.currentPeriodEnd)?.toISOString() ?? null } });
}
