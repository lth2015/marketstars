import { prisma } from "@/lib/db";
import { getSession, isOperator } from "@/lib/session";
import { GENESIS, verifyLedger } from "@/lib/ledger";

/** 台帐导出：第三方可用同样的规则（sha256(prevHash + "\n" + 规范化 JSON)）独立验证。 */
export async function GET() {
  const s = await getSession();
  if (!(await isOperator(s))) return new Response("Forbidden", { status: 403 });
  const [entries, anchors, check] = await Promise.all([prisma.ledgerEntry.findMany({ orderBy: { seq: "asc" } }), prisma.ledgerAnchor.findMany({ orderBy: { createdAt: "asc" } }), verifyLedger()]);
  const body = { format: "marketstars-ledger/1", genesis: GENESIS, hash: "sha256(prevHash + '\\n' + canonicalJSON({kind, refId, amountJpy, tenantId, providerId, occurredAt, payload}))", verified: check, entries, anchors };
  return new Response(JSON.stringify(body, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": 'attachment; filename="marketstars-ledger.json"' } });
}
