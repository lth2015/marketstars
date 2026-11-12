import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatJst } from "@/lib/time";
import { yen } from "@/lib/text";
import { Flash } from "@/components/Flash";
import { confirmDueAction, refundAction } from "../actions";

export default async function AdminBilling({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const sp = await searchParams;
  const rows = await prisma.billingRecord.findMany({ include: { subscription: { include: { app: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
  return (
    <div className="stack">
      <div className="section-head"><h1 style={{ margin: 0 }}>請求記録</h1><a className="btn btn-secondary btn-sm" href="/admin/billing/export">CSV 出力</a></div>
      <Flash msg={sp.msg} error={sp.error} />
      {rows.length === 0 ? <div className="empty">請求記録はまだありません。申込処理で入金を確認すると記録されます。</div> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>空間 / アプリ</th><th>期間</th><th>金額</th><th>状態</th><th>証憑</th><th>確認</th><th>操作</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td>{r.subscription.tenantName}<div className="small muted">{r.subscription.app.name}{r.kind === "usage" ? "（AI従量）" : ""}</div></td>
              <td className="small">{formatJst(r.periodStart, true)}〜{formatJst(r.periodEnd, true)}</td>
              <td>{yen(r.amountJpy)}</td><td>{r.status}</td><td className="small">{r.receiptRef}</td><td className="small">{formatJst(r.paidAt, true)}<div className="muted">{r.confirmedBy}</div></td>
              <td>{r.status === "due" && r.channel === "starpay" ? <span className="small muted">StarPay 合算（回収確認は「StarPay 合算請求」で）</span> : r.status === "due" ? <form action={confirmDueAction} className="row"><input type="hidden" name="id" value={r.id} /><input name="receiptRef" placeholder="入金証憑" required style={{ height: 30, width: 110, border: "1px solid var(--border)", borderRadius: 6, padding: "0 6px" }} /><input name="amountJpy" type="number" defaultValue={r.amountJpy} style={{ height: 30, width: 80 }} /><button className="btn btn-primary btn-sm">入金確認</button></form> : r.status === "paid" ? <form action={refundAction} className="row"><input type="hidden" name="id" value={r.id} /><input name="note" placeholder="返金証憑・メモ" required style={{ height: 30, width: 130, border: "1px solid var(--border)", borderRadius: 6, padding: "0 6px" }} /><button className="btn btn-ghost btn-sm">返金記録</button></form> : <span className="small muted">{r.note}</span>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
