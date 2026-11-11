import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateAppClient, problem } from "@/lib/api";
import { isEntitled, liveSubscription } from "@/lib/subscriptions";
import { ALLOWED_MODELS, DEFAULT_MODEL, chat, type ChatMessage } from "@/lib/models/gateway";
import { costMilli, monthUsage } from "@/lib/usage";

/**
 * 统一模型网关：接入应用用自身 client 凭证代表租户调用模型。
 * 网关校验权益与月度上限，调用模型后按套餐单价记录 Token 用量（requestId 幂等，重复请求不重复计费）。
 */
export async function POST(req: Request) {
  const app = await authenticateAppClient(req);
  if (!app) return problem(401, "invalid_client", "client authentication failed");
  const b = (await req.json().catch(() => null)) as { tenant_id?: string; request_id?: string; model?: string; system?: string; messages?: ChatMessage[]; max_tokens?: number; effort?: "low" | "medium" | "high" } | null;
  if (!b?.tenant_id || !b.request_id || !Array.isArray(b.messages) || !b.messages.length) return problem(400, "invalid_request", "tenant_id, request_id and messages are required");
  if (!/^[A-Za-z0-9_.:-]{8,100}$/.test(b.request_id)) return problem(400, "invalid_request", "request_id format");
  if (b.messages.some((m) => !["user", "assistant"].includes(m.role) || typeof m.content !== "string") || b.messages[0].role !== "user") return problem(400, "invalid_request", "messages must alternate text turns starting with user");
  const totalChars = (b.system ?? "").length + b.messages.reduce((a, m) => a + m.content.length, 0);
  if (totalChars > 20000) return problem(413, "too_large", "input too large for the gateway (20,000 chars)");
  const model = b.model ?? DEFAULT_MODEL();
  if (!(ALLOWED_MODELS as readonly string[]).includes(model)) return problem(400, "invalid_model", `model must be one of ${ALLOWED_MODELS.join(", ")}`);

  const sub = await liveSubscription(b.tenant_id, app.id);
  if (!sub || !isEntitled(sub) || app.suspendedReason) return problem(403, "not_entitled", "tenant has no active entitlement");
  const dup = await prisma.usageEvent.findUnique({ where: { appId_requestId: { appId: app.id, requestId: b.request_id } } });
  if (dup) return problem(409, "duplicate_request", "request_id already used; usage was recorded once");
  const unit = sub.plan.tokenPriceJpyPerMTok;
  if (sub.usageCapJpy !== null && unit > 0) {
    const used = await monthUsage(sub.id);
    if (used.costJpy >= sub.usageCapJpy) return problem(429, "usage_cap_reached", `monthly usage cap ¥${sub.usageCapJpy} reached`);
  }

  let r;
  try {
    r = await chat({ model, system: b.system, messages: b.messages, maxTokens: Math.min(Math.max(16, b.max_tokens ?? 1024), 4096), effort: b.effort });
  } catch (e) {
    console.error(JSON.stringify({ severity: "ERROR", message: "model.gateway.failed", app: app.slug, error: String(e) }));
    return problem(502, "model_error", "model provider error");
  }
  const tokens = r.inputTokens + r.outputTokens;
  try {
    await prisma.usageEvent.create({ data: { appId: app.id, requestId: b.request_id, tenantId: sub.tenantId, subscriptionId: sub.id, planVersionId: sub.planVersionId, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, unitPriceJpyPerMTok: unit, costMilliJpy: costMilli(tokens, unit) } });
  } catch {
    return problem(409, "duplicate_request", "request_id already used");
  }
  return NextResponse.json({ text: r.text, model: r.model, stop_reason: r.stopReason, usage: { input_tokens: r.inputTokens, output_tokens: r.outputTokens, unit_price_jpy_per_mtok: unit, cost_jpy: costMilli(tokens, unit) / 1000 } });
}
