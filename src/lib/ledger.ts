// 防篡改结算台帐：按发生顺序把资金事件追加为哈希链。只追加，不修改；验证时从头重算。
// 锚点（链头哈希）可对外公布或写入区块链；本版本只生成锚点，未连接任何链。
import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

export const GENESIS = "0".repeat(64);

/** 键排序的规范化 JSON，保证同样内容得到同样哈希。 */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
}

export function entryHash(prevHash: string, e: { kind: string; refId: string; amountJpy: number; tenantId: string | null; providerId: string | null; occurredAt: Date; payload: unknown }) {
  const body = canonical({ kind: e.kind, refId: e.refId, amountJpy: e.amountJpy, tenantId: e.tenantId, providerId: e.providerId, occurredAt: e.occurredAt.toISOString(), payload: e.payload });
  return crypto.createHash("sha256").update(prevHash + "\n" + body).digest("hex");
}

type Pending = { kind: string; refId: string; amountJpy: number; tenantId: string | null; providerId: string | null; occurredAt: Date; payload: Record<string, unknown> };

/** 定时任务：把尚未入账的资金事件按发生时间顺序追加（单写者，由任务锁保证）。 */
export async function ingestLedger() {
  const done = new Set((await prisma.ledgerEntry.findMany({ select: { kind: true, refId: true } })).map((x) => `${x.kind}:${x.refId}`));
  const pending: Pending[] = [];
  const bills = await prisma.billingRecord.findMany({ where: { paidAt: { not: null } }, include: { subscription: { include: { app: { select: { slug: true, providerId: true } } } } } });
  for (const b of bills) {
    const common = { tenantId: b.tenantId, providerId: b.subscription.app.providerId };
    if (!done.has(`payment:${b.id}`)) pending.push({ kind: "payment", refId: b.id, amountJpy: b.amountJpy, occurredAt: b.paidAt!, ...common, payload: { billingKind: b.kind, app: b.subscription.app.slug, subscriptionId: b.subscriptionId, receiptRef: b.receiptRef, periodStart: b.periodStart.toISOString(), periodEnd: b.periodEnd.toISOString() } });
    if (b.refundedAt && !done.has(`refund:${b.id}`)) pending.push({ kind: "refund", refId: b.id, amountJpy: -b.amountJpy, occurredAt: b.refundedAt, ...common, payload: { app: b.subscription.app.slug, note: b.note ?? null } });
  }
  const payouts = await prisma.payoutStatement.findMany({ where: { status: "paid" } });
  for (const p of payouts) {
    if (!done.has(`payout_paid:${p.id}`)) pending.push({ kind: "payout_paid", refId: p.id, amountJpy: -p.payoutJpy, tenantId: null, providerId: p.providerId, occurredAt: p.paidAt ?? p.generatedAt, payload: { month: p.month, gross: p.grossJpy, fee: p.platformFeeJpy, reference: p.paidReference } });
  }
  pending.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.kind.localeCompare(b.kind) || a.refId.localeCompare(b.refId));
  let prev = (await prisma.ledgerEntry.findFirst({ orderBy: { seq: "desc" } }))?.hash ?? GENESIS;
  for (const e of pending) {
    const h = entryHash(prev, e);
    await prisma.ledgerEntry.create({ data: { ...e, payload: e.payload as Prisma.InputJsonValue, prevHash: prev, hash: h } });
    prev = h;
  }
  return pending.length;
}

/** 从创世块重算整条链，返回第一个不一致的位置。 */
export async function verifyLedger() {
  const rows = await prisma.ledgerEntry.findMany({ orderBy: { seq: "asc" } });
  let prev = GENESIS;
  for (const r of rows) {
    if (r.prevHash !== prev) return { ok: false as const, count: rows.length, brokenAt: r.seq, reason: "prevHash がひとつ前の記録と一致しません" };
    const h = entryHash(prev, { ...r, payload: r.payload });
    if (h !== r.hash) return { ok: false as const, count: rows.length, brokenAt: r.seq, reason: "記録内容がハッシュと一致しません（改ざんの可能性）" };
    prev = r.hash;
  }
  // 锚点必须仍在链上
  for (const a of await prisma.ledgerAnchor.findMany()) {
    const r = rows.find((x) => x.seq === a.seq);
    if (!r || r.hash !== a.hash) return { ok: false as const, count: rows.length, brokenAt: a.seq, reason: "アンカーと台帳が一致しません" };
  }
  return { ok: true as const, count: rows.length, head: prev };
}

/** 生成锚点（链头有变化时）。 */
export async function anchorLedger() {
  const head = await prisma.ledgerEntry.findFirst({ orderBy: { seq: "desc" } });
  if (!head) return null;
  const last = await prisma.ledgerAnchor.findFirst({ orderBy: { createdAt: "desc" } });
  if (last?.seq === head.seq) return null;
  return prisma.ledgerAnchor.create({ data: { seq: head.seq, hash: head.hash, entries: head.seq } });
}
