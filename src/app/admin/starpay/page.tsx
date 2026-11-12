import { prisma } from "@/lib/db";
import { formatJst } from "@/lib/time";
import { yen } from "@/lib/text";
import { unbilledByMonth } from "@/lib/starpay";
import { Flash } from "@/components/Flash";
import { starpayStatementAction } from "../actions";

export const metadata = { title: "StarPay 合算請求" };

export default async function StarpayAdmin({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const sp = await searchParams;
  const [pending, statements, links] = await Promise.all([
    unbilledByMonth(),
    prisma.starpayStatement.findMany({ orderBy: { month: "desc" }, take: 24 }),
    prisma.starpayLink.count(),
  ]);
  const inp = { height: 34, border: "1px solid var(--border)", borderRadius: 8, padding: "0 8px" } as const;
  return (
    <div className="stack">
      <h1>StarPay 合算請求</h1>
      <p className="small muted">
        StarPay と連携した空間（現在 {links} 空間）は、有料プランの利用料を StarPay の月次請求に合算して支払えます。申込時点で利用開始・毎月自動更新し、各期間の請求は「合算請求待ち」になります。
        月ごとに合算明細を作成して CSV を StarPay の請求システムへ連携し、StarPay からの回収を確認すると、明細内の請求がすべて入金済みになります（台帳と提供会社への精算にも反映）。
      </p>
      <Flash msg={sp.msg} error={sp.error} />

      <section className="panel stack">
        <h2 style={{ margin: 0, fontSize: 18 }}>明細に未掲載の合算請求</h2>
        {pending.length === 0 ? <p className="small muted" style={{ margin: 0 }}>未掲載の請求はありません。</p> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>対象月（利用期間の開始月）</th><th>件数</th><th>金額</th><th></th></tr></thead><tbody>
            {pending.map((p) => (
              <tr key={p.month}><td>{p.month}</td><td>{p.count}</td><td>{yen(p.totalJpy)}</td><td>
                <form action={starpayStatementAction}><input type="hidden" name="op" value="build" /><input type="hidden" name="month" value={p.month} /><button className="btn btn-secondary btn-sm">合算明細を作成</button></form>
              </td></tr>
            ))}
          </tbody></table></div>
        )}
      </section>

      <section className="stack">
        <h2 style={{ margin: 0, fontSize: 18 }}>合算明細</h2>
        {statements.length === 0 ? <div className="empty">合算明細はまだありません。</div> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>対象月</th><th>件数</th><th>金額</th><th>状態</th><th>CSV</th><th>回収確認</th></tr></thead><tbody>
            {statements.map((st) => (
              <tr key={st.id}>
                <td>{st.month}</td><td>{st.itemCount}</td><td>{yen(st.totalJpy)}</td>
                <td>{st.status === "settled" ? `回収済み（${formatJst(st.settledAt, true)}）` : "回収待ち"}</td>
                <td><a href={`/admin/starpay/export?id=${st.id}`}>ダウンロード</a></td>
                <td>{st.status === "settled" ? <span className="small">{st.settledRef}</span> : (
                  <form action={starpayStatementAction} className="row" style={{ gap: 8 }}>
                    <input type="hidden" name="op" value="settle" /><input type="hidden" name="id" value={st.id} />
                    <input name="ref" aria-label={`${st.month} の回収参照番号`} placeholder="回収参照番号" required style={{ ...inp, width: 160 }} />
                    <button className="btn btn-primary btn-sm">回収を確認</button>
                  </form>
                )}</td>
              </tr>
            ))}
          </tbody></table></div>
        )}
      </section>
    </div>
  );
}
