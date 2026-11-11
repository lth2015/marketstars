import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { getDeveloper } from "@/lib/developer";
import { activationsByMonth, kpis, perAppStats, revenueByMonth } from "@/lib/metrics";
import { SERIES, StackedBars, StatTile, pct } from "@/components/charts";
import { yen } from "@/lib/text";

export const metadata = { title: "アプリの分析" };

export default async function DevAnalytics() {
  const s = await getSession();
  if (!s) redirect("/auth/login?returnTo=/developer/analytics");
  const p = await getDeveloper(s);
  if (!p) redirect("/developer");
  const apps = await prisma.app.findMany({ where: { providerId: p.id }, select: { id: true, name: true, status: true }, orderBy: { name: "asc" } });
  const appIds = apps.map((a) => a.id);
  const [k, rev, act, per] = await Promise.all([kpis({ appIds }), revenueByMonth(6, { appIds }), activationsByMonth(6, { appIds }), perAppStats(appIds)]);
  return (
    <div className="container" style={{ maxWidth: 1100, paddingBottom: 64 }}>
      <div className="breadcrumb"><Link href="/developer">開発者ポータル</Link> ／ 分析</div>
      <h1 style={{ marginTop: 12 }}>アプリの分析</h1>
      <p className="small muted">{p.name} のアプリ全体。金額は税込・提供会社への分配前の売上です（分配後は「売上・精算」）。</p>
      <div className="stat-grid">
        <StatTile label="MRR" value={yen(k.mrr)} sub={`有料契約 ${k.active.paid} 件`} />
        <StatTile label="利用中の空間" value={`${k.active.paid + k.active.free} 件`} sub={`無料体験中 ${k.active.trial} 件`} />
        <StatTile label="体験 → 有料 転換率（90日）" value={pct(k.trial.rate)} sub={`${k.trial.started} 件中 ${k.trial.converted} 件`} />
        <StatTile label="有料解約率（30日）" value={pct(k.churn.rate)} sub={`終了 ${k.churn.ended} 件`} />
      </div>
      <div className="grid-2" style={{ marginTop: 16 }}>
        <div className="panel"><StackedBars title="月別売上" data={rev.map((r) => ({ label: r.month, values: [{ key: "s", name: "月額", value: r.subscription, color: SERIES.subscription }, { key: "u", name: "AI 従量", value: r.usage, color: SERIES.usage }] }))} /></div>
        <div className="panel"><StackedBars title="月別の新規利用開始" money={false} data={act.map((a) => ({ label: a.month, values: [{ key: "n", name: "新規利用開始", value: a.count, color: SERIES.subscription }] }))} /></div>
      </div>
      <h2 style={{ marginTop: 32 }}>アプリ別</h2>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>アプリ</th><th style={{ textAlign: "right" }}>有料</th><th style={{ textAlign: "right" }}>無料</th><th style={{ textAlign: "right" }}>体験中</th><th style={{ textAlign: "right" }}>体験→有料（90日）</th><th style={{ textAlign: "right" }}>MRR</th><th style={{ textAlign: "right" }}>今月の AI 利用</th></tr></thead>
        <tbody>{per.map((r) => { const a = apps.find((x) => x.id === r.appId)!; return (
          <tr key={r.appId}><td><Link href={`/developer/apps/${r.appId}`}>{a.name}</Link>{a.status !== "published" && <span className="small muted">（未公開）</span>}</td>
            <td style={{ textAlign: "right" }}>{r.paid}</td><td style={{ textAlign: "right" }}>{r.free}</td><td style={{ textAlign: "right" }}>{r.trial}</td>
            <td style={{ textAlign: "right" }}>{r.trialsStarted ? `${pct(r.trialsConverted / r.trialsStarted)}（${r.trialsConverted}/${r.trialsStarted}）` : "—"}</td>
            <td style={{ textAlign: "right" }}>{yen(k.mrrByApp[r.appId] ?? 0)}</td>
            <td style={{ textAlign: "right" }} className="small">{r.usageRequests ? `${r.usageRequests} 回 ・ ${r.usageTokens.toLocaleString()} tokens ・ ${yen(r.usageJpy)}` : "—"}</td></tr>
        ); })}</tbody>
      </table></div>
    </div>
  );
}
