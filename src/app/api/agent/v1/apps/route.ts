import { NextResponse, type NextRequest } from "next/server";
import { appAllowed, authenticateAgent, hasScope } from "@/lib/agentpay";
import { listApps, parseListQuery } from "@/lib/catalog";
import { appJson } from "@/lib/serialize";
import { problem } from "@/lib/api";
import { hit, LIMITS, tooMany } from "@/lib/ratelimit";

/** 代理用的目录搜索：只返回授权允许的应用。 */
export async function GET(req: NextRequest) {
  const m = await authenticateAgent(req);
  if (!m) return problem(401, "invalid_agent_key", "agent key invalid, revoked or expired");
  { const rl = await hit(`agent:${m.id}`, LIMITS.agentApi); if (!rl.ok) return tooMany(rl.retryAfter); }
  if (!hasScope(m, "catalog")) return problem(403, "scope", "catalog scope required");
  const sp: Record<string, string[]> = {};
  req.nextUrl.searchParams.forEach((v, k) => (sp[k] ??= []).push(v));
  const r = await listApps({ ...parseListQuery(sp), perPage: 50, page: 1 });
  return NextResponse.json({ items: r.items.filter((a) => appAllowed(m, a.id)).map(appJson) });
}
