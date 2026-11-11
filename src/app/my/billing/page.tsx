import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { formatJst } from "@/lib/time";
import { yen } from "@/lib/text";

export const metadata = { title: "請求・お支払い" };
const LABEL: Record<string, string> = { due: "未入金", paid: "入金確認済み", refunded: "返金済み", void: "取消" };

export default async function Billing() {
  const s = await getSession();
  if (!s) redirect("/auth/login?returnTo=/my/billing");
  if (!s.isOwner) {
    return <div className="container" style={{ padding: "32px 16px" }}><h1>請求・お支払い</h1><div className="alert alert-warn">請求情報は空間のオーナーのみ閲覧できます。</div></div>;
  }
  const rows = await prisma.billingRecord.findMany({ where: { tenantId: s.tenantId! }, include: { subscription: { include: { app: { select: { name: true } } } } }, orderBy: { createdAt: "desc" } });
  const pending = await prisma.subscription.findMany({ where: { tenantId: s.tenantId!, status: "pending" }, include: { app: { select: { name: true } } } });
  return (
    <div className="container" style={{ paddingBottom: 64 }}>
      <div className="breadcrumb"><Link href="/my/apps">マイアプリ</Link> ／ 請求・お支払い</div>
      <h1 style={{ marginTop: 12 }}>請求・お支払い</h1>
      <p className="muted small">空間：<strong>{s.tenantName}</strong>　金額はすべて税込です。</p>
      {pending.length > 0 && <div className="alert alert-info">お支払い確認待ちのお申し込み：{pending.map((p) => `${p.app.name}（${yen(p.priceJpySnapshot)}）`).join("、")}。運営からのご案内に沿ってお支払いください。</div>}
      {rows.length === 0 ? <div className="empty">請求履歴はまだありません。</div> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>アプリ</th><th>対象期間</th><th>金額</th><th>状態</th><th>入金確認日</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td>{r.subscription.app.name}</td><td>{formatJst(r.periodStart)} 〜 {formatJst(r.periodEnd)}</td><td>{yen(r.amountJpy)}</td><td>{LABEL[r.status] ?? r.status}</td><td>{formatJst(r.paidAt)}</td></tr>)}</tbody>
        </table></div>
      )}
    </div>
  );
}
