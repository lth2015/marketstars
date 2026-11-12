// StarPay 合算請求（PRD §2「与原服务合并收费」P1）。
// StarPay 加盟店と連携した空間は、有料プランの利用料を StarPay の月次請求に合算して支払える。
// - 申込時点で利用開始・毎月自動更新。各期間の請求は「合算請求待ち（due, channel=starpay）」として記録する。
// - 運営が月ごとに合算明細を作成（CSV を StarPay の請求システムへ連携）し、StarPay からの回収を確認すると入金済みになる。
// 加盟店の照合は StarPay 加盟店 API の代わりに決定的な mock を使う（デモ・テスト用）。
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { audit } from "./audit";
import { BizError } from "./subscriptions";
import { emitSubscriptionEvent } from "./events";
import type { SessionUser } from "./session";

export type Merchant = { merchantId: string; merchantName: string };

/** StarPay 加盟店 API（mock）：SP + 8 桁。末尾が 9 の番号は「存在しない加盟店」として扱う。 */
export async function lookupMerchant(raw: string): Promise<Merchant | null> {
  const id = raw.trim().toUpperCase().replace(/[\s-]/g, "");
  if (!/^SP\d{8}$/.test(id) || id.endsWith("9")) return null;
  return { merchantId: id, merchantName: `StarPay 加盟店 ${id.slice(-4)}` };
}

export function getLink(tenantId: string | null | undefined) {
  return tenantId ? prisma.starpayLink.findUnique({ where: { tenantId } }) : Promise.resolve(null);
}

function requireOwner(s: SessionUser) {
  if (!s.tenantId || !s.isOwner) throw new BizError("not_owner", "この操作は空間のオーナーのみ可能です。");
}

export async function linkStarpay(s: SessionUser, merchantId: string) {
  requireOwner(s);
  const m = await lookupMerchant(merchantId);
  if (!m) throw new BizError("merchant", "StarPay 加盟店番号を確認できませんでした。番号（SP から始まる10桁）をご確認ください。");
  try {
    const link = await prisma.starpayLink.upsert({ where: { tenantId: s.tenantId! }, create: { tenantId: s.tenantId!, ...m, linkedBy: s.userId }, update: { ...m, linkedBy: s.userId, linkedAt: new Date() } });
    await audit(prisma, { actorId: s.userId, actorType: "user", tenantId: s.tenantId, objectType: "starpay_link", objectId: s.tenantId!, action: "link", data: { merchantId: m.merchantId } });
    return link;
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new BizError("merchant_taken", "この加盟店番号は別の空間と連携済みです。");
    throw e;
  }
}

export async function unlinkStarpay(s: SessionUser) {
  requireOwner(s);
  const using = await prisma.subscription.count({ where: { tenantId: s.tenantId!, paymentMode: "starpay", liveKey: { not: null }, status: { in: ["active", "cancel_scheduled", "suspended"] } } });
  if (using) throw new BizError("in_use", `StarPay 合算で利用中の契約（${using}件）があります。先に期末解約するか、支払い方法を変更してください。`);
  await prisma.starpayLink.deleteMany({ where: { tenantId: s.tenantId! } });
  await audit(prisma, { actorId: s.userId, actorType: "user", tenantId: s.tenantId, objectType: "starpay_link", objectId: s.tenantId!, action: "unlink" });
}

/** JST の YYYY-MM。 */
export function jstMonthKey(d: Date) {
  const j = new Date(d.getTime() + 9 * 3600000);
  return `${j.getUTCFullYear()}-${String(j.getUTCMonth() + 1).padStart(2, "0")}`;
}
function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1) - 9 * 3600000);
  const end = new Date(Date.UTC(y, m, 1) - 9 * 3600000);
  return { start, end };
}

/** まだ明細に載っていない合算請求を月ごとに集計（運営画面用）。 */
export async function unbilledByMonth() {
  const rows = await prisma.billingRecord.findMany({ where: { channel: "starpay", status: "due", starpayStatementId: null }, select: { periodStart: true, amountJpy: true } });
  const m = new Map<string, { month: string; count: number; totalJpy: number }>();
  for (const r of rows) {
    const k = jstMonthKey(r.periodStart);
    const e = m.get(k) ?? { month: k, count: 0, totalJpy: 0 };
    e.count++;
    e.totalJpy += r.amountJpy;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** 月次の合算明細を作成する。同じ月は 1 件だけ：未回収の明細があれば、後から発生した請求を追加する（冪等）。 */
export async function buildStatement(op: { userId: string }, month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new BizError("month", "対象月が不正です。");
  const { start, end } = monthRange(month);
  return prisma.$transaction(async (tx) => {
    let st = await tx.starpayStatement.findUnique({ where: { month } });
    if (st?.status === "settled") throw new BizError("state", "この月の合算明細は回収済みです。");
    if (!st) st = await tx.starpayStatement.create({ data: { month, totalJpy: 0, itemCount: 0, createdBy: op.userId } });
    await tx.billingRecord.updateMany({ where: { channel: "starpay", status: "due", starpayStatementId: null, periodStart: { gte: start, lt: end } }, data: { starpayStatementId: st.id } });
    const agg = await tx.billingRecord.aggregate({ where: { starpayStatementId: st.id }, _sum: { amountJpy: true }, _count: true });
    if (!agg._count) throw new BizError("empty", "この月に合算する請求はありません。");
    st = await tx.starpayStatement.update({ where: { id: st.id }, data: { totalJpy: agg._sum.amountJpy ?? 0, itemCount: agg._count } });
    await audit(tx, { actorId: op.userId, actorType: "operator", objectType: "starpay_statement", objectId: st.id, action: "build", data: { month, total: st.totalJpy, items: st.itemCount } });
    return st;
  });
}

/** StarPay からの回収を確認：明細の全請求を入金済みにする。回収の参照番号は必須、同じ明細の二重確認はしない。 */
export async function settleStatement(op: { userId: string }, id: string, settledRef: string) {
  const ref = settledRef.trim();
  if (!ref) throw new BizError("receipt", "StarPay の回収参照番号を入力してください。");
  const settled = await prisma.$transaction(async (tx) => {
    const lock = await tx.starpayStatement.updateMany({ where: { id, status: "open" }, data: { status: "settled", settledRef: ref, settledAt: new Date(), settledBy: op.userId } });
    if (!lock.count) throw new BizError("state", "この明細は回収確認済みか、存在しません。");
    const bills = await tx.billingRecord.findMany({ where: { starpayStatementId: id, status: "due" } });
    const now = new Date();
    for (const b of bills) {
      await tx.billingRecord.update({ where: { id: b.id }, data: { status: "paid", paidAt: now, paidAmountJpy: b.amountJpy, receiptRef: `${ref}#${b.id}`, confirmedBy: op.userId } });
      await emitSubscriptionEvent(tx as Prisma.TransactionClient, "payment.succeeded", b.subscriptionId, { amountJpy: b.amountJpy }, `payment:starpay:${b.id}`);
    }
    await audit(tx, { actorId: op.userId, actorType: "operator", objectType: "starpay_statement", objectId: id, action: "settle", data: { settledRef: ref, items: bills.length } });
    return bills.length;
  });
  return settled;
}

/** StarPay の請求システムへ渡す CSV（加盟店ごとの明細行）。 */
export async function statementCsv(id: string) {
  const st = await prisma.starpayStatement.findUniqueOrThrow({ where: { id } });
  const bills = await prisma.billingRecord.findMany({ where: { starpayStatementId: id }, include: { subscription: { include: { app: { select: { name: true } } } } }, orderBy: [{ tenantId: "asc" }, { periodStart: "asc" }] });
  const links = new Map((await prisma.starpayLink.findMany({ where: { tenantId: { in: [...new Set(bills.map((b) => b.tenantId))] } } })).map((l) => [l.tenantId, l]));
  const esc = (v: unknown) => { const s = String(v ?? ""); const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };
  const header = ["month", "merchant_id", "tenant_name", "app", "plan", "period_start", "period_end", "amount_jpy", "billing_id"];
  const lines = bills.map((b) => [st.month, links.get(b.tenantId)?.merchantId ?? "", b.subscription.tenantName, b.subscription.app.name, b.subscription.planNameSnapshot, b.periodStart.toISOString(), b.periodEnd.toISOString(), b.amountJpy, b.id].map(esc).join(","));
  return { filename: `marketstars-starpay-${st.month}.csv`, body: "﻿" + [header.join(","), ...lines].join("\r\n") };
}
