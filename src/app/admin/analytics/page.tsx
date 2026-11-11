import { prisma } from "@/lib/db";
import { activationsByMonth, kpis, revenueByMonth } from "@/lib/metrics";
import { SERIES, StackedBars, StatTile, pct } from "@/components/charts";
import { yen } from "@/lib/text";

export default async function Analytics() {
  const [k, rev, act] = await Promise.all([kpis(), revenueByMonth(6), activationsByMonth(6)]);
  const apps = await prisma.app.findMany({ where: { id: { in: Object.keys(k.mrrByApp) } }, select: { id: true, name: true, provider: { select: { name: true } } } });
  const top = Object.entries(k.mrrByApp).sort((a, b) => b[1] - a[1]).slice(0, 10);
  return (
    <div className="stack">
      <h1>分析</h1>
      <p className="small muted">金額は税込。社内テストを除きます。月は日本時間。MRR は現在有効な有料契約の月額合計（AI 従量は含みません）。</p>
      <div className="stat-grid">
        <StatTile label="MRR（月額の経常収益）" value={yen(k.mrr)} sub={`有料契約 ${k.active.paid} 件`} />
        <StatTile label="有効な契約" value={`${(k.active.paid + k.active.free + k.active.trial).toLocaleString()} 件`} sub={`有料 ${k.active.paid} ・ 無料 ${k.active.free} ・ 体験中 ${k.active.trial}`} />
        <StatTile label="無料体験 → 有料 転換率（90日）" value={pct(k.trial.rate)} sub={`${k.trial.started} 件中 ${k.trial.converted} 件`} />
        <StatTile label="有料解約率（30日）" value={pct(k.churn.rate)} sub={`終了 ${k.churn.ended} 件 ／ 対象 ${k.churn.base} 件`} />
      </div>
      <div className="grid-2">
        <div className="panel"><StackedBars title="月別売上（入金ベース・返金控除後）" data={rev.map((r) => ({ label: r.month, values: [{ key: "s", name: "月額", value: r.subscription, color: SERIES.subscription }, { key: "u", name: "AI 従量", value: r.usage, color: SERIES.usage }] }))} /></div>
        <div className="panel"><StackedBars title="月別の新規利用開始（無料・有料、体験を除く）" money={false} data={act.map((a) => ({ label: a.month, values: [{ key: "n", name: "新規利用開始", value: a.count, color: SERIES.subscription }] }))} /></div>
      </div>
      <h2>MRR 上位アプリ</h2>
      {top.length === 0 ? <div className="empty">有料契約はまだありません。</div> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>アプリ</th><th>提供会社</th><th style={{ textAlign: "right" }}>MRR</th><th style={{ textAlign: "right" }}>構成比</th></tr></thead><tbody>
          {top.map(([id, v]) => { const a = apps.find((x) => x.id === id); return <tr key={id}><td>{a?.name}</td><td className="small">{a?.provider.name}</td><td style={{ textAlign: "right" }}>{yen(v)}</td><td style={{ textAlign: "right" }}>{pct(k.mrr ? v / k.mrr : null)}</td></tr>; })}
        </tbody></table></div>
      )}
    </div>
  );
}
