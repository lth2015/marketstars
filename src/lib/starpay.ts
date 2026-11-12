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

/** 連携の変更を止める条件：StarPay 合算の有料契約が生きている、または未回収の合算請求がある。 */
async function starpayInUse(tx: Prisma.TransactionClient, tenantId: string) {
  const [subs, bills] = await Promise.all([
    tx.subscription.count({ where: { tenantId, paymentMode: "starpay", kind: "paid", liveKey: { not: null }, status: { in: ["active", "cancel_scheduled", "suspended"] } } }),
    tx.billingRecord.count({ where: { tenantId, channel: "starpay", status: "due" } }),
  ]);
  return { subs, bills };
}

export async function linkStarpay(s: SessionUser, merchantId: string) {
  requireOwner(s);
  const m = await lookupMerchant(merchantId);
  if (!m) throw new BizError("merchant", "StarPay 加盟店番号を確認できませんでした。番号（SP から始まる10桁）をご確認ください。");
  try {
    return await prisma.$transaction(async (tx) => {
      const cur = await tx.starpayLink.findUnique({ where: { tenantId: s.tenantId! } });
      // 別の加盟店への付け替えは、合算中の契約・未回収の請求がない場合だけ（請求先が変わらないように）
      if (cur && cur.merchantId !== m.merchantId) {
        const u = await starpayInUse(tx, s.tenantId!);
        if (u.subs || u.bills) throw new BizError("in_use", `StarPay 合算で利用中の契約（${u.subs}件）または未回収の合算請求（${u.bills}件）があるため、加盟店を変更できません。`);
      }
      const link = await tx.starpayLink.upsert({ where: { tenantId: s.tenantId! }, create: { tenantId: s.tenantId!, ...m, linkedBy: s.userId }, update: { ...m, linkedBy: s.userId, linkedAt: new Date() } });
      await audit(tx, { actorId: s.userId, actorType: "user", tenantId: s.tenantId, objectType: "starpay_link", objectId: s.tenantId!, action: "link", data: { merchantId: m.merchantId } });
      return link;
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new BizError("merchant_taken", "この加盟店番号は別の空間と連携済みです。");
    throw e;
  }
}

export async function unlinkStarpay(s: SessionUser) {
  requireOwner(s);
  await prisma.$transaction(async (tx) => {
    // 連携行をロックしてから確認：同時に行われた合算の申込（連携の存在を確認する）と競合しない
    await tx.$queryRaw`SELECT tenantId FROM StarpayLink WHERE tenantId = ${s.tenantId!} FOR UPDATE`;
    const u = await starpayInUse(tx, s.tenantId!);
    if (u.subs) throw new BizError("in_use", `StarPay 合算で利用中の契約（${u.subs}件）があります。先に期末解約するか、支払い方法を変更してください。`);
    if (u.bills) throw new BizError("in_use", `未回収の合算請求（${u.bills}件）があります。StarPay での回収が確認されてから解除できます。`);
    await tx.starpayLink.deleteMany({ where: { tenantId: s.tenantId! } });
    await audit(tx, { actorId: s.userId, actorType: "user", tenantId: s.tenantId, objectType: "starpay_link", objectId: s.tenantId!, action: "unlink" });
  });
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

/** その月の合算請求を受け付けている明細（open）がないなら、後から来た請求は次に受け付けている月へ繰り越す。 */
function nextOpenMonth(month: string, closed: Set<string>) {
  let m = month;
  while (closed.has(m)) {
    const [y, mm] = m.split("-").map(Number);
    m = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`;
  }
  return m;
}

/** まだ明細に載っていない合算請求を、載せる予定の月ごとに集計（運営画面用）。CSV 出力済み・回収済みの月の請求は翌月以降へ繰り越す。 */
export async function unbilledByMonth() {
  const [rows, closedRows] = await Promise.all([
    prisma.billingRecord.findMany({ where: { channel: "starpay", status: "due", starpayStatementId: null }, select: { periodStart: true, amountJpy: true } }),
    prisma.starpayStatement.findMany({ where: { status: { in: ["exported", "settled"] } }, select: { month: true } }),
  ]);
  const closed = new Set(closedRows.map((c) => c.month));
  const m = new Map<string, { month: string; count: number; totalJpy: number }>();
  for (const r of rows) {
    const k = nextOpenMonth(jstMonthKey(r.periodStart), closed);
    const e = m.get(k) ?? { month: k, count: 0, totalJpy: 0 };
    e.count++;
    e.totalJpy += r.amountJpy;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * 月次の合算明細を作成する。月ごとに 1 件で、CSV 出力前（open）なら後から発生した請求を追加できる（冪等）。
 * その月までに開始した未掲載の請求をすべて載せる（出力済み・回収済みの月から繰り越された請求を含む）。
 */
export async function buildStatement(op: { userId: string }, month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new BizError("month", "対象月が不正です。");
  const { end } = monthRange(month);
  const ensure = async () => {
    try {
      return await prisma.starpayStatement.create({ data: { month, totalJpy: 0, itemCount: 0, createdBy: op.userId } });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") return prisma.starpayStatement.findUniqueOrThrow({ where: { month } });
      throw e;
    }
  };
  const existing = (await prisma.starpayStatement.findUnique({ where: { month } })) ?? (await ensure());
  return prisma.$transaction(async (tx) => {
    // 明細行をロック：CSV 出力・回収確認と同時に走っても、出力済みの明細へ請求が混ざらない
    const locked = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM StarpayStatement WHERE id = ${existing.id} FOR UPDATE`;
    if (locked[0]?.status !== "open") throw new BizError("state", "この月の合算明細は CSV 出力済みです。後から発生した請求は翌月の明細に載ります。");
    // 載せる予定の月（繰り越し後）がこの月の請求だけを載せる（まだ明細のない前月分は前月の明細へ）
    const closed = new Set((await tx.starpayStatement.findMany({ where: { status: { in: ["exported", "settled"] } }, select: { month: true } })).map((c) => c.month));
    const candidates = await tx.billingRecord.findMany({ where: { channel: "starpay", status: "due", starpayStatementId: null, periodStart: { lt: end } }, select: { id: true, periodStart: true } });
    const ids = candidates.filter((b) => nextOpenMonth(jstMonthKey(b.periodStart), closed) === month).map((b) => b.id);
    if (ids.length) await tx.billingRecord.updateMany({ where: { id: { in: ids }, starpayStatementId: null }, data: { starpayStatementId: existing.id } });
    const agg = await tx.billingRecord.aggregate({ where: { starpayStatementId: existing.id, status: "due" }, _sum: { amountJpy: true }, _count: true });
    if (!agg._count) throw new BizError("empty", "この月に合算する請求はありません。");
    const st = await tx.starpayStatement.update({ where: { id: existing.id }, data: { totalJpy: agg._sum.amountJpy ?? 0, itemCount: agg._count } });
    await audit(tx, { actorId: op.userId, actorType: "operator", objectType: "starpay_statement", objectId: st.id, action: "build", data: { month, total: st.totalJpy, items: st.itemCount } });
    return st;
  });
}

/** CSV 出力で明細を確定する（open → exported）。以後この明細には追加しない。出力した内容と回収確認の対象が一致する。 */
export async function exportStatement(op: { userId: string }, id: string) {
  await prisma.starpayStatement.updateMany({ where: { id, status: "open" }, data: { status: "exported" } });
  await audit(prisma, { actorId: op.userId, actorType: "operator", objectType: "starpay_statement", objectId: id, action: "export_csv" });
  return statementCsv(id);
}

/** StarPay からの回収を確認：CSV 出力済みの明細の請求をすべて入金済みにする。回収の参照番号は必須、同じ明細の二重確認はしない。 */
export async function settleStatement(op: { userId: string }, id: string, settledRef: string) {
  const ref = settledRef.trim();
  if (!ref) throw new BizError("receipt", "StarPay の回収参照番号を入力してください。");
  const settled = await prisma.$transaction(async (tx) => {
    const lock = await tx.starpayStatement.updateMany({ where: { id, status: "exported" }, data: { status: "settled", settledRef: ref, settledAt: new Date(), settledBy: op.userId } });
    if (!lock.count) throw new BizError("state", "CSV 出力前、または回収確認済みの明細です。");
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
  const bills = await prisma.billingRecord.findMany({ where: { starpayStatementId: id, status: { in: ["due", "paid"] }, channel: "starpay" }, include: { subscription: { include: { app: { select: { name: true } } } } }, orderBy: [{ tenantId: "asc" }, { periodStart: "asc" }] });
  // 値の中の改行（CR/LF）は除き、= + - @ で始まる値には ' を付けて数式として解釈されないようにする
  const esc = (v: unknown) => { const s = String(v ?? "").replace(/[\r\n]+/g, " "); const safe = /^[=+\-@\t]/.test(s) ? `'${s}` : s; return /[",]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };
  const header = ["month", "merchant_id", "tenant_name", "app", "plan", "period_start_jst", "period_end_jst", "amount_jpy", "billing_id"];
  const jst = (d: Date) => new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 16).replace("T", " ");
  const lines = bills.map((b) => [st.month, b.starpayMerchantId ?? "", b.subscription.tenantName, b.subscription.app.name, b.subscription.planNameSnapshot, jst(b.periodStart), jst(b.periodEnd), b.amountJpy, b.id].map(esc).join(","));
  return { filename: `marketstars-starpay-${st.month}.csv`, body: "\ufeff" + [header.join(","), ...lines].join("\r\n") };
}
