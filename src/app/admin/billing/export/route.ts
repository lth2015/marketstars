import { prisma } from "@/lib/db";
import { getSession, isOperator } from "@/lib/session";
import { audit } from "@/lib/audit";

const esc = (v: unknown) => {
  const s = (v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v)).replace(/[\r\n]+/g, " ");
  // CSV 注入防护：以 = + - @ 开头的值加前缀
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export async function GET() {
  const s = await getSession();
  if (!(await isOperator(s))) return new Response("Forbidden", { status: 403 });
  const rows = await prisma.billingRecord.findMany({ include: { subscription: { include: { app: true } } }, orderBy: { createdAt: "asc" } });
  const header = ["id", "kind", "tenant_id", "tenant_name", "app", "plan", "period_start", "period_end", "amount_jpy", "status", "receipt_ref", "paid_amount_jpy", "paid_at", "confirmed_by", "refunded_at", "note"];
  const lines = rows.map((r) => [r.id, r.kind, r.tenantId, r.subscription.tenantName, r.subscription.app.slug, r.subscription.planNameSnapshot, r.periodStart, r.periodEnd, r.amountJpy, r.status, r.receiptRef, r.paidAmountJpy, r.paidAt, r.confirmedBy, r.refundedAt, r.note].map(esc).join(","));
  await audit(prisma, { actorId: s!.userId, actorType: "operator", objectType: "billing", objectId: "*", action: "export_csv", data: { rows: rows.length } });
  return new Response("﻿" + [header.join(","), ...lines].join("\r\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="marketstars-billing.csv"` } });
}
