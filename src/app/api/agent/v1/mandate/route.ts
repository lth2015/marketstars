import { NextResponse } from "next/server";
import { authenticateAgent, monthSpend } from "@/lib/agentpay";
import { problem } from "@/lib/api";
import { hit, LIMITS, tooMany } from "@/lib/ratelimit";

export async function GET(req: Request) {
  const m = await authenticateAgent(req);
  if (!m) return problem(401, "invalid_agent_key", "agent key invalid, revoked or expired");
  { const rl = await hit(`agent:${m.id}`, LIMITS.agentApi); if (!rl.ok) return tooMany(rl.retryAfter); }
  const spent = await monthSpend(m.id);
  return NextResponse.json({ name: m.name, tenant: m.tenantName, scopes: m.scopes.split(","), monthly_budget_jpy: m.monthlyBudgetJpy, spent_this_month_jpy: spent, remaining_jpy: Math.max(0, m.monthlyBudgetJpy - spent), per_tx_limit_jpy: m.perTxLimitJpy, allowed_app_ids: m.allowedAppIds ?? null, expires_at: m.expiresAt.toISOString() });
}
