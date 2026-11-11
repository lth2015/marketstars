import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { appFlagAction, publishAction, retirePlanAction, saveDraftAction, savePlanAction } from "../../actions";
import { draftFromApp } from "@/lib/publishing";
import { AppDraftEditor } from "@/components/AppDraftEditor";
import { Flash } from "@/components/Flash";
import { priceLabel } from "@/lib/text";

export default async function EditApp({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const app = await prisma.app.findUnique({ where: { id }, include: { categories: true, industries: true, integrationTags: true, plans: { orderBy: [{ planKey: "asc" }, { version: "desc" }] }, releases: { orderBy: { number: "desc" }, take: 5 } } });
  if (!app) notFound();
  const [providers, cats, inds, integs, liveCount] = await Promise.all([
    prisma.provider.findMany({ orderBy: { name: "asc" } }), prisma.category.findMany({ orderBy: { sortOrder: "asc" } }), prisma.industry.findMany({ orderBy: { sortOrder: "asc" } }), prisma.integrationTag.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.subscription.count({ where: { appId: id, liveKey: { not: null } } }),
  ]);
  const d = draftFromApp(app);
  const current = app.plans.filter((p) => p.current);
  const Flag = ({ flag, label, variant = "btn-secondary", reason }: { flag: string; label: string; variant?: string; reason?: boolean }) => (
    <form action={appFlagAction} className="row"><input type="hidden" name="id" value={id} /><input type="hidden" name="flag" value={flag} />{reason && <input name="reason" placeholder="理由（必須）" required style={{ height: 34, border: "1px solid var(--border)", borderRadius: 8, padding: "0 8px" }} />}<button className={`btn ${variant} btn-sm`}>{label}</button></form>
  );

  return (
    <div className="stack">
      <div className="section-head"><div><h1 style={{ margin: 0 }}>{app.name}</h1><div className="small muted">{app.slug} ・ {app.status}{app.draft ? " ・ 未公開の下書きあり" : ""}{app.reviewStatus === "submitted" ? " ・ 審査待ち" : ""} ・ 有効契約 {liveCount} 件</div></div>
        <Link className="btn btn-secondary btn-sm" href={`/apps/${app.slug}?preview=1`} target="_blank">プレビュー</Link></div>
      <Flash msg={sp.msg} error={sp.error} />

      <div className="panel stack">
        <h2 style={{ margin: 0 }}>公開・受付</h2>
        <div className="row">
          <form action={publishAction}><input type="hidden" name="id" value={id} /><button className="btn btn-primary btn-sm" disabled={!app.draft}>下書きを公開する</button></form>
          {app.acceptingNew ? <Flag flag="stop_new" label="新規受付を停止" /> : <Flag flag="resume_new" label="新規受付を再開" />}
          {app.suspendedReason ? <Flag flag="unsuspend" label="一時停止を解除" /> : <Flag flag="suspend" label="事故・障害で一時停止" variant="btn-danger" reason />}
          <Flag flag="archive" label="アーカイブ" variant="btn-danger" />
        </div>
        {app.suspendedReason && <div className="alert alert-error" style={{ margin: 0 }}>一時停止中：{app.suspendedReason}</div>}
        <form action={appFlagAction} className="row"><input type="hidden" name="id" value={id} /><input type="hidden" name="flag" value="weight" /><label className="small" htmlFor="weight">おすすめ順の重み（0＝おすすめに出さない）</label><input id="weight" name="weight" type="number" min={0} max={1000} defaultValue={app.recommendWeight} style={{ width: 90, height: 34 }} /><button className="btn btn-secondary btn-sm">保存</button></form>
        <form action={appFlagAction} className="row"><input type="hidden" name="id" value={id} /><input type="hidden" name="flag" value="internal" /><input type="hidden" name="value" value={app.internalTest ? "0" : "1"} /><span className="small">社内テスト用（公開一覧・ランキングから除外）：{app.internalTest ? "はい" : "いいえ"}</span><button className="btn btn-ghost btn-sm">切り替え</button></form>
      </div>

      {d.plans && <div className="alert alert-info">開発者が提案した料金プランがあります（公開時に新しい版として反映）：{d.plans.map((p) => `${p.key}${p.retire ? "（終了）" : `：${p.priceType === "monthly" ? `¥${p.priceJpy.toLocaleString()}` : p.priceType}`}`).join("、")}</div>}
      <AppDraftEditor action={saveDraftAction} id={id} draft={d} providers={providers} cats={cats} inds={inds} integs={integs} showClientId planRows={false} submitLabel="下書きを保存" note="保存は下書きとして行われ、公開中の内容は「下書きを公開する」まで変わりません。プレビューで確認してから公開してください。" />

      <div className="panel stack">
        <h2 style={{ margin: 0 }}>料金プラン</h2>
        <p className="small muted" style={{ margin: 0 }}>料金・内容を変更すると新しい版が作成されます。確定済みの契約は申込時の料金・条件のまま保持されます。</p>
        <div className="table-wrap"><table className="table"><thead><tr><th>キー</th><th>版</th><th>名称</th><th>料金</th><th>体験</th><th>状態</th><th></th></tr></thead><tbody>
          {app.plans.map((p) => <tr key={p.id}><td>{p.planKey}</td><td>v{p.version}</td><td>{p.name}</td><td>{priceLabel(p)}</td><td>{p.trialDays ? `${p.trialDays}日` : "—"}</td><td>{p.current ? "受付中" : "旧版"}</td>
            <td>{p.current && <form action={retirePlanAction}><input type="hidden" name="appId" value={id} /><input type="hidden" name="planId" value={p.id} /><button className="btn btn-ghost btn-sm">受付終了</button></form>}</td></tr>)}
        </tbody></table></div>
        <details><summary style={{ cursor: "pointer", fontWeight: 600 }}>プランを追加・新しい版を作成</summary>
          <form action={savePlanAction} style={{ marginTop: 12 }}>
            <input type="hidden" name="appId" value={id} />
            <div className="grid-2">
              <div className="form-row"><label htmlFor="planKey">プランキー（既存キーなら新しい版）</label><input id="planKey" name="planKey" type="text" required list="plan-keys" /><datalist id="plan-keys">{current.map((p) => <option key={p.id} value={p.planKey} />)}</datalist></div>
              <div className="form-row"><label htmlFor="pname">名称</label><input id="pname" name="name" type="text" required /></div>
              <div className="form-row"><label htmlFor="priceType">料金種別</label><select id="priceType" name="priceType"><option value="monthly">月額固定</option><option value="free">無料</option><option value="contact">要問い合わせ</option></select></div>
              <div className="form-row"><label htmlFor="priceJpy">月額（税込・円／1空間）</label><input id="priceJpy" name="priceJpy" type="number" min={0} /></div>
              <div className="form-row"><label htmlFor="trialDays">無料体験日数</label><input id="trialDays" name="trialDays" type="number" min={0} max={90} defaultValue={0} /></div>
              <div className="form-row"><label htmlFor="sortOrder">表示順</label><input id="sortOrder" name="sortOrder" type="number" defaultValue={0} /></div>
            </div>
            <div className="form-row"><label htmlFor="includes">含まれる内容</label><textarea id="includes" name="includes" /></div>
            <div className="form-row"><label htmlFor="limits">制限</label><textarea id="limits" name="limits" /></div>
            <label className="check" style={{ marginBottom: 12 }}><input type="checkbox" name="ext" />提供会社との別途契約が必要</label>
            <button className="btn btn-primary btn-sm">保存（新しい版）</button>
          </form>
        </details>
      </div>

      {app.releases.length > 0 && <div className="panel small"><strong>公開履歴</strong><ul>{app.releases.map((r) => <li key={r.id}>#{r.number} {r.createdAt.toISOString()} by {r.publishedBy}</li>)}</ul></div>}
    </div>
  );
}
