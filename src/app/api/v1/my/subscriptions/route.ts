import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { problem } from "@/lib/api";
import { applyForApp, BizError } from "@/lib/subscriptions";

export async function GET() {
  const s = await getSession();
  if (!s?.tenantId) return problem(401, "unauthenticated", "login required");
  const subs = await prisma.subscription.findMany({ where: { tenantId: s.tenantId }, include: { app: { select: { slug: true, name: true } } }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ items: subs.map((x) => ({ id: x.id, app: x.app.slug, app_name: x.app.name, status: x.status, kind: x.kind, plan: x.planNameSnapshot, price_jpy: x.priceJpySnapshot, trial_ends_at: x.trialEndsAt, current_period_end: x.currentPeriodEnd, cancel_at: x.cancelAt })) });
}

/** 租户来自已验证会话，不接受客户端传入 tenant_id；需要 X-CSRF-Token 与 Idempotency-Key。 */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s?.tenantId) return problem(401, "unauthenticated", "login required");
  if (req.headers.get("x-csrf-token") !== s.csrfToken) return problem(403, "csrf", "invalid csrf token");
  const key = req.headers.get("idempotency-key");
  if (!key) return problem(428, "idempotency_key_required", "Idempotency-Key header is required");
  const b = (await req.json().catch(() => ({}))) as { app_slug?: string; plan_id?: string; expected_price_jpy?: number; mode?: string; agreed?: boolean };
  const app = b.app_slug ? await prisma.app.findUnique({ where: { slug: b.app_slug } }) : null;
  if (!app) return problem(404, "not_found", "app not found");
  try {
    const sub = await applyForApp(s, { appId: app.id, planVersionId: String(b.plan_id), expectedPriceJpy: Number(b.expected_price_jpy), mode: b.mode === "trial" ? "trial" : "start", idempotencyKey: key, agreed: b.agreed === true });
    return NextResponse.json({ id: sub.id, status: sub.status, kind: sub.kind }, { status: 201 });
  } catch (e) {
    if (e instanceof BizError) return problem(e.code === "not_owner" ? 403 : e.code === "exists" || e.code === "trial_used" ? 409 : e.code === "price_changed" ? 409 : 400, e.code, e.message);
    throw e;
  }
}
