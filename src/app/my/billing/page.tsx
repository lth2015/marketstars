import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { formatJst } from "@/lib/time";
import { yen } from "@/lib/text";
import { removeCardAction } from "@/app/actions";
import { AddCardForm } from "@/components/AddCardForm";
import { CardFields } from "@/components/CardFields";
import { Flash } from "@/components/Flash";

export const metadata = { title: "請求・お支払い" };
const LABEL: Record<string, string> = { due: "未入金", paid: "入金確認済み", refunded: "返金済み", void: "取消" };

export default async function Billing({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const sp = await searchParams;
  const s = await getSession();
  if (!s) redirect("/auth/login?returnTo=/my/billing");
  if (!s.isOwner) {
    return <div className="container" style={{ padding: "32px 16px" }}><h1>請求・お支払い</h1><div className="alert alert-warn">請求情報は空間のオーナーのみ閲覧できます。</div></div>;
  }
  const rows = await prisma.billingRecord.findMany({ where: { tenantId: s.tenantId! }, include: { subscription: { include: { app: { select: { name: true } } } } }, orderBy: { createdAt: "desc" } });
  const pending = await prisma.subscription.findMany({ where: { tenantId: s.tenantId!, status: "pending", paymentMode: "invoice" }, include: { app: { select: { name: true } } } });
  const cards = await prisma.paymentMethod.findMany({ where: { tenantId: s.tenantId!, active: true }, include: { subscriptions: { where: { autoRenew: true, liveKey: { not: null } }, include: { app: { select: { name: true } } } } }, orderBy: { createdAt: "desc" } });
  const failed = await prisma.paymentIntent.findMany({ where: { tenantId: s.tenantId!, status: "failed" }, include: { subscription: { include: { app: { select: { name: true } } } } }, orderBy: { updatedAt: "desc" }, take: 5 });
  return (
    <div className="container" style={{ paddingBottom: 64 }}>
      <div className="breadcrumb"><Link href="/my/apps">マイアプリ</Link> ／ 請求・お支払い</div>
      <h1 style={{ marginTop: 12 }}>請求・お支払い</h1>
      <p className="muted small">空間：<strong>{s.tenantName}</strong>　金額はすべて税込です。</p>
      <Flash msg={sp.msg} error={sp.error} />
      <h2 style={{ marginTop: 24 }}>支払い方法</h2>
      <div className="panel stack" style={{ marginBottom: 32 }}>
        {cards.length === 0 && <p className="small muted" style={{ margin: 0 }}>登録済みのカードはありません。</p>}
        {cards.map((c) => (
          <form key={c.id} action={removeCardAction} className="row" style={{ justifyContent: "space-between" }}>
            <input type="hidden" name="id" value={c.id} />
            <span><strong>{c.brand} •••• {c.last4}</strong> <span className="small muted">有効期限 {String(c.expMonth).padStart(2, "0")}/{String(c.expYear).slice(-2)}{c.subscriptions.length ? ` ・ 自動更新：${c.subscriptions.map((x) => x.app.name).join("、")}` : ""}</span></span>
            <button className="btn btn-ghost btn-sm">削除</button>
          </form>
        ))}
        <details><summary style={{ cursor: "pointer", fontWeight: 600 }}>カードを追加</summary><div style={{ marginTop: 8 }}><AddCardForm><CardFields /></AddCardForm></div></details>
      </div>
      {failed.length > 0 && <div className="alert alert-error">お支払いに失敗した請求があります：{failed.map((f) => `${f.subscription.app.name}（${yen(f.amountJpy)}・${f.failureReason ?? ""}）`).join("、")}</div>}
      <h2>請求履歴</h2>
      {pending.length > 0 && <div className="alert alert-info">お支払い確認待ちのお申し込み：{pending.map((p) => `${p.app.name}（${yen(p.priceJpySnapshot)}）`).join("、")}。運営からのご案内に沿ってお支払いください。</div>}
      {rows.length === 0 ? <div className="empty">請求履歴はまだありません。</div> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>アプリ</th><th>対象期間</th><th>金額</th><th>状態</th><th>入金日</th><th>方法</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td>{r.subscription.app.name}</td><td>{formatJst(r.periodStart)} 〜 {formatJst(r.periodEnd)}</td><td>{yen(r.amountJpy)}</td><td>{LABEL[r.status] ?? r.status}</td><td>{formatJst(r.paidAt)}</td><td>{r.receiptRef?.startsWith("ch_") ? "カード" : "請求書"}</td></tr>)}</tbody>
        </table></div>
      )}
    </div>
  );
}
