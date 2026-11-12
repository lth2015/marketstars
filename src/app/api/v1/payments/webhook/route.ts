import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { problem } from "@/lib/api";
import { BizError, settleIntent } from "@/lib/subscriptions";
import { audit } from "@/lib/audit";
import { limitIp, LIMITS, tooMany } from "@/lib/ratelimit";

/**
 * 支付服务商的异步通知（3DS 等延迟确认场景）。签名：hex(HMAC-SHA256(PAYMENT_WEBHOOK_SECRET, rawBody))
 * 放在 X-Payment-Signature。结算幂等：intent 已 succeeded 时直接返回。
 */
export async function POST(req: Request) {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!secret) return problem(503, "not_configured", "webhook secret not configured");
  const rl = await limitIp("paywh", LIMITS.paymentWebhook, req);
  if (!rl.ok) return tooMany(rl.retryAfter);
  const raw = await req.text();
  const sig = req.headers.get("x-payment-signature") ?? "";
  const expect = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return problem(401, "bad_signature", "invalid signature");
  const ev = JSON.parse(raw) as { type?: string; intent_id?: string; charge_id?: string; reason?: string };
  if (!ev.intent_id) return problem(400, "invalid_request", "intent_id required");
  const intent = await prisma.paymentIntent.findUnique({ where: { id: ev.intent_id } });
  if (!intent) return problem(404, "not_found", "intent not found");
  if (ev.type === "charge.succeeded" && ev.charge_id) {
    try {
      await settleIntent(intent.id, ev.charge_id, { actorId: "payment-webhook", actorType: "system" });
    } catch (e) {
      if (e instanceof BizError) return problem(409, e.code, e.message);
      throw e;
    }
  } else if (ev.type === "charge.failed") {
    // 処理中（課金リクエスト中）・完了・取消済みの決済は変えない：処理中を failed に戻すと再課金で二重請求になり得る
    await prisma.paymentIntent.updateMany({ where: { id: intent.id, status: "requires_payment" }, data: { status: "failed", failureReason: ev.reason ?? "failed" } });
    await audit(prisma, { actorId: "payment-webhook", actorType: "system", tenantId: intent.tenantId, objectType: "payment_intent", objectId: intent.id, action: "charge_failed", reason: ev.reason ?? null });
  }
  return Response.json({ received: true });
}
