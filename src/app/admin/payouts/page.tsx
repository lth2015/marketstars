import { prisma } from "@/lib/db";
import { formatJst } from "@/lib/time";
import { yen } from "@/lib/text";
import { prevMonth } from "@/lib/usage";
import { Flash } from "@/components/Flash";
import { payoutAction } from "../actions";

type Line = { app: string; gross: number; refund: number; count: number };

export default async function Payouts({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const sp = await searchParams;
  const [rows, providers] = await Promise.all([
    prisma.payoutStatement.findMany({ include: { provider: true }, orderBy: [{ month: "desc" }, { payoutJpy: "desc" }], take: 100 }),
    prisma.provider.findMany({ orderBy: { name: "asc" } }),
  ]);
  const inp = { height: 34, border: "1px solid var(--border)", borderRadius: 8, padding: "0 8px" } as const;
  return (
    <div className="stack">
      <h1>提供会社への精算（自動分配）</h1>
      <p className="small muted">毎月初の定期処理で前月分の精算書を自動作成します。対象は当月に入金確認された請求（月額・AI従量）で、当月の返金を差し引き、分配率に応じて提供会社への支払額を計算します。作成済みの精算書は変更せず、後から発生した返金は翌月の精算に反映されます。</p>
      <Flash msg={sp.msg} error={sp.error} />
      <form action={payoutAction} className="panel row">
        <input type="hidden" name="op" value="generate" />
        <label className="small" htmlFor="month">対象月</label>
        <input id="month" name="month" defaultValue={prevMonth().key} style={inp} />
        <button className="btn btn-secondary btn-sm">精算書を作成</button>
      </form>
      {rows.length === 0 ? <div className="empty">精算書はまだありません。</div> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>月</th><th>提供会社</th><th>売上</th><th>返金</th><th>手数料</th><th>支払額</th><th>内訳</th><th>状態</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td>{r.month}</td><td>{r.provider.name}<div className="small muted">分配 {r.shareBps / 100}%</div></td>
              <td>{yen(r.grossJpy)}</td><td>{yen(r.refundJpy)}</td><td>{yen(r.platformFeeJpy)}</td><td><strong>{yen(r.payoutJpy)}</strong></td>
              <td className="small">{(r.lines as Line[]).map((l) => `${l.app}：${yen(l.gross)}${l.refund ? ` / 返金 ${yen(l.refund)}` : ""}`).join("、")}</td>
              <td>{r.status === "paid" ? <span className="small">支払済み {formatJst(r.paidAt)}<div className="muted">{r.paidReference}</div></span> : (
                <form action={payoutAction} className="row"><input type="hidden" name="op" value="paid" /><input type="hidden" name="id" value={r.id} /><input name="reference" placeholder="振込参照番号" required style={{ ...inp, width: 120 }} /><button className="btn btn-primary btn-sm">支払済み</button></form>
              )}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <h2>分配率</h2>
      <div className="panel stack">
        {providers.map((p) => (
          <form key={p.id} action={payoutAction} className="row">
            <input type="hidden" name="op" value="share" /><input type="hidden" name="providerId" value={p.id} />
            <span style={{ minWidth: 180 }}>{p.name}</span>
            <input name="sharePct" type="number" step="0.01" min={0} max={100} defaultValue={p.revenueShareBps / 100} style={{ ...inp, width: 90 }} aria-label={`${p.name} の分配率`} /> <span className="small">%</span>
            <span className="small muted">{p.payoutAccount ? `振込先：${p.payoutAccount}` : "振込先未登録"}</span>
            <button className="btn btn-ghost btn-sm">保存</button>
          </form>
        ))}
      </div>
    </div>
  );
}
