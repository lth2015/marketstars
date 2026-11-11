import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { appFlagAction, publishAction, retirePlanAction, saveDraftAction, savePlanAction, type AppDraft } from "../../actions";
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
  const ov = (app.overview ?? {}) as Partial<AppDraft["overview"]>;
  const sc = (app.supportChannels ?? []) as { type: string; value: string }[];
  const d: AppDraft = (app.draft as unknown as AppDraft) ?? {
    name: app.name, tagline: app.tagline, tags: app.tags, iconUrl: app.iconUrl, screenshots: (app.screenshots ?? []) as AppDraft["screenshots"],
    overview: { problem: ov.problem ?? "", features: ov.features ?? [], prerequisites: ov.prerequisites ?? "", dataNeeds: ov.dataNeeds ?? "", setup: ov.setup ?? [], limitations: ov.limitations ?? "" },
    launchUrl: app.launchUrl, integrationType: app.integrationType, launchClientId: app.launchClientId, supportChannels: sc, privacyUrl: app.privacyUrl, termsUrl: app.termsUrl, version: app.version, providerId: app.providerId,
    categories: app.categories.map((c) => c.slug), industries: app.industries.map((c) => c.slug), integrations: app.integrationTags.map((c) => c.slug),
  };
  const current = app.plans.filter((p) => p.current);
  const Field = ({ name, label, value, area, hint, type = "text" }: { name: string; label: string; value?: string | null; area?: boolean; hint?: string; type?: string }) => (
    <div className="form-row"><label htmlFor={name}>{label}</label>{area ? <textarea id={name} name={name} defaultValue={value ?? ""} /> : <input id={name} name={name} type={type} defaultValue={value ?? ""} />}{hint && <div className="hint">{hint}</div>}</div>
  );
  const Flag = ({ flag, label, variant = "btn-secondary", reason }: { flag: string; label: string; variant?: string; reason?: boolean }) => (
    <form action={appFlagAction} className="row"><input type="hidden" name="id" value={id} /><input type="hidden" name="flag" value={flag} />{reason && <input name="reason" placeholder="理由（必須）" required style={{ height: 34, border: "1px solid var(--border)", borderRadius: 8, padding: "0 8px" }} />}<button className={`btn ${variant} btn-sm`}>{label}</button></form>
  );

  return (
    <div className="stack">
      <div className="section-head"><div><h1 style={{ margin: 0 }}>{app.name}</h1><div className="small muted">{app.slug} ・ {app.status}{app.draft ? " ・ 未公開の下書きあり" : ""} ・ 有効契約 {liveCount} 件</div></div>
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

      <form action={saveDraftAction} className="panel">
        <h2>掲載内容（下書き）</h2>
        <p className="small muted">保存は下書きとして行われ、公開中の内容は「下書きを公開する」まで変わりません。HTML は表示されず、すべてテキストとして扱われます。</p>
        <input type="hidden" name="id" value={id} />
        <div className="grid-2">
          <Field name="name" label="アプリ名" value={d.name} />
          <div className="form-row"><label htmlFor="providerId">提供会社</label><select id="providerId" name="providerId" defaultValue={d.providerId}>{providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        </div>
        <Field name="tagline" label="概要（一覧に2行で表示）" value={d.tagline} />
        <Field name="tags" label="検索タグ（スペース区切り）" value={d.tags} />
        <Field name="iconUrl" label="アイコン URL" value={d.iconUrl} hint="Cloud Storage の https URL（64px 以上の正方形）" />
        <Field name="screenshots" label="スクリーンショット（1行に「URL|代替テキスト」）" area value={d.screenshots.map((s) => `${s.url}|${s.alt}`).join("\n")} />
        <Field name="problem" label="解決できること" area value={d.overview.problem} />
        <Field name="features" label="主な機能（1行に1つ）" area value={d.overview.features.join("\n")} />
        <div className="grid-2"><Field name="prerequisites" label="利用の前提" area value={d.overview.prerequisites} /><Field name="dataNeeds" label="利用するデータ" area value={d.overview.dataNeeds} /></div>
        <div className="grid-2"><Field name="setup" label="設定の流れ（1行に1ステップ）" area value={d.overview.setup.join("\n")} /><Field name="limitations" label="制限事項" area value={d.overview.limitations} /></div>
        {[["categories", "カテゴリ", cats, d.categories], ["industries", "業種", inds, d.industries], ["integrations", "連携サービス（実際に対応している場合のみ）", integs, d.integrations]].map(([key, label, list, sel]) => (
          <fieldset key={key as string} className="form-row" style={{ border: 0, padding: 0 }}><legend style={{ fontWeight: 600, fontSize: 14 }}>{label as string}</legend><div className="row">
            {(list as { slug: string; name: string }[]).map((c) => <label key={c.slug} className="check"><input type="checkbox" name={key as string} value={c.slug} defaultChecked={(sel as string[]).includes(c.slug)} />{c.name}</label>)}
          </div></fieldset>
        ))}
        <div className="grid-2">
          <Field name="launchUrl" label="アプリ起動 URL（https のみ）" value={d.launchUrl} />
          <div className="form-row"><label htmlFor="integrationType">接続方式</label><select id="integrationType" name="integrationType" defaultValue={d.integrationType}><option value="external">外部サービス（別途ログインの可能性あり）</option><option value="sso_integrated">共通 SSO・権益チェック接入済み</option></select></div>
        </div>
        <Field name="launchClientId" label="接入 client ID（接入済みの場合）" value={d.launchClientId} hint="secret は Secret Manager の LAUNCH_CLIENT_SECRET_<ID> に登録" />
        <div className="grid-2">
          <Field name="supportEmail" label="サポート連絡先" value={d.supportChannels.find((s) => s.type === "email")?.value} />
          <Field name="supportHours" label="受付時間" value={d.supportChannels.find((s) => s.type === "hours")?.value} />
          <Field name="termsUrl" label="利用規約 URL" value={d.termsUrl} />
          <Field name="privacyUrl" label="プライバシーポリシー URL" value={d.privacyUrl} />
          <Field name="version" label="バージョン" value={d.version} />
        </div>
        <button className="btn btn-primary">下書きを保存</button>
      </form>

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
