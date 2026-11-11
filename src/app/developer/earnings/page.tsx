import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { getDeveloper } from "@/lib/developer";
import { formatJst } from "@/lib/time";
import { yen } from "@/lib/text";
import { jstMonth } from "@/lib/usage";
import { Flash } from "@/components/Flash";
import { payoutAccountAction } from "../actions";

type Line = { app: string; gross: number; refund: number; count: number };

export default async function Earnings({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const sp = await searchParams;
  const s = await getSession();
  if (!s) redirect("/auth/login?returnTo=/developer/earnings");
  const p = await getDeveloper(s);
  if (!p) redirect("/developer");
  const m = jstMonth();
  const [statements, current] = await Promise.all([
    prisma.payoutStatement.findMany({ where: { providerId: p.id }, orderBy: { month: "desc" } }),
    prisma.billingRecord.aggregate({ where: { subscription: { internalTest: false, app: { providerId: p.id } }, paidAt: { gte: m.start, lt: m.end } }, _sum: { amountJpy: true } }),
  ]);
  const gross = current._sum.amountJpy ?? 0;
  return (
    <div className="container" style={{ maxWidth: 1000, paddingBottom: 64 }}>
      <div className="breadcrumb"><Link href="/developer">開発者ポータル</Link> ／ 売上・精算</div>
      <h1 style={{ marginTop: 12 }}>売上・精算</h1>
      <Flash msg={sp.msg} error={sp.error} />
      <div className="card-grid cols-auto">
        <div className="panel"><div className="small muted">今月（{m.key}）の売上（入金確認済み）</div><div style={{ fontSize: 28, fontWeight: 800 }}>{yen(gross)}</div></div>
        <div className="panel"><div className="small muted">分配率</div><div style={{ fontSize: 28, fontWeight: 800 }}>{p.revenueShareBps / 100}%</div><div className="small muted">今月の見込み支払額 {yen(Math.floor((gross * p.revenueShareBps) / 10000))}（返金を除く）</div></div>
      </div>
      <h2 style={{ marginTop: 32 }}>精算書</h2>
      {statements.length === 0 ? <div className="empty">精算書はまだありません。毎月初に前月分が自動で作成されます。</div> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>月</th><th>売上</th><th>返金</th><th>手数料</th><th>支払額</th><th>内訳</th><th>状態</th></tr></thead>
          <tbody>{statements.map((r) => (
            <tr key={r.id}><td>{r.month}</td><td>{yen(r.grossJpy)}</td><td>{yen(r.refundJpy)}</td><td>{yen(r.platformFeeJpy)}</td><td><strong>{yen(r.payoutJpy)}</strong></td>
              <td className="small">{(r.lines as Line[]).map((l) => `${l.app}：${yen(l.gross)}`).join("、")}</td>
              <td>{r.status === "paid" ? `振込済み ${formatJst(r.paidAt)}` : "振込待ち"}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      <form action={payoutAccountAction} className="panel" style={{ marginTop: 32 }}>
        <h2>振込先</h2>
        <div className="form-row"><label htmlFor="pa">金融機関・支店・口座種別・口座番号・名義</label><textarea id="pa" name="payoutAccount" defaultValue={p.payoutAccount ?? ""} /></div>
        <button className="btn btn-secondary btn-sm" disabled={!s.isOwner}>保存</button>
      </form>
    </div>
  );
}
