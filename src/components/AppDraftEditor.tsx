import type { AppDraft } from "@/lib/publishing";

type Opt = { slug: string; name: string };

export function AppDraftEditor(props: {
  action: (fd: FormData) => Promise<void>;
  id: string;
  draft: AppDraft;
  providers?: { id: string; name: string }[];
  cats: Opt[]; inds: Opt[]; integs: Opt[];
  showClientId: boolean;
  planRows: boolean;
  submitLabel: string;
  note?: string;
}) {
  const d = props.draft;
  const Field = ({ name, label, value, area, hint }: { name: string; label: string; value?: string | null; area?: boolean; hint?: string }) => (
    <div className="form-row"><label htmlFor={`f-${name}`}>{label}</label>{area ? <textarea id={`f-${name}`} name={name} defaultValue={value ?? ""} /> : <input id={`f-${name}`} name={name} type="text" defaultValue={value ?? ""} />}{hint && <div className="hint">{hint}</div>}</div>
  );
  const rows = props.planRows ? [...(d.plans ?? []), { key: "", name: "", priceType: "monthly", priceJpy: 0, trialDays: 0, includes: "", limits: "", ext: false, sortOrder: 99 }] : [];
  return (
    <form action={props.action} className="panel">
      <h2>掲載内容（下書き）</h2>
      <p className="small muted">{props.note ?? "保存は下書きとして行われ、公開中の内容は公開するまで変わりません。"}HTML は表示されず、すべてテキストとして扱われます。</p>
      <input type="hidden" name="id" value={props.id} />
      <div className="grid-2">
        <Field name="name" label="アプリ名" value={d.name} />
        {props.providers ? (
          <div className="form-row"><label htmlFor="f-providerId">提供会社</label><select id="f-providerId" name="providerId" defaultValue={d.providerId}>{props.providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        ) : <Field name="version" label="バージョン" value={d.version} />}
      </div>
      <Field name="tagline" label="概要（一覧に2行で表示）" value={d.tagline} />
      <Field name="tags" label="検索タグ（スペース区切り）" value={d.tags} />
      <div className="grid-2">
        <Field name="iconUrl" label="アイコン URL" value={d.iconUrl} hint="https の画像 URL、または右でアップロード" />
        <div className="form-row"><label htmlFor="f-iconFile">アイコンをアップロード（PNG/JPEG/WebP・2MB まで）</label><input id="f-iconFile" name="iconFile" type="file" accept="image/png,image/jpeg,image/webp" /></div>
      </div>
      <Field name="screenshots" label="スクリーンショット（1行に「URL|代替テキスト」）" area value={d.screenshots.map((s) => `${s.url}|${s.alt}`).join("\n")} />
      <div className="form-row"><label htmlFor="f-screenshotFiles">スクリーンショットを追加アップロード（複数可・8枚まで）</label><input id="f-screenshotFiles" name="screenshotFiles" type="file" multiple accept="image/png,image/jpeg,image/webp" /></div>
      <Field name="problem" label="解決できること" area value={d.overview.problem} />
      <Field name="features" label="主な機能（1行に1つ）" area value={d.overview.features.join("\n")} />
      <div className="grid-2"><Field name="prerequisites" label="利用の前提" area value={d.overview.prerequisites} /><Field name="dataNeeds" label="利用するデータ" area value={d.overview.dataNeeds} /></div>
      <div className="grid-2"><Field name="setup" label="設定の流れ（1行に1ステップ）" area value={d.overview.setup.join("\n")} /><Field name="limitations" label="制限事項" area value={d.overview.limitations} /></div>
      {([["categories", "カテゴリ", props.cats, d.categories], ["industries", "業種", props.inds, d.industries], ["integrations", "連携サービス（実際に対応している場合のみ）", props.integs, d.integrations]] as const).map(([key, label, list, sel]) => (
        <fieldset key={key} className="form-row" style={{ border: 0, padding: 0 }}><legend style={{ fontWeight: 600, fontSize: 14 }}>{label}</legend><div className="row">
          {list.map((c) => <label key={c.slug} className="check"><input type="checkbox" name={key} value={c.slug} defaultChecked={sel.includes(c.slug)} />{c.name}</label>)}
        </div></fieldset>
      ))}
      <div className="grid-2">
        <Field name="launchUrl" label="アプリ起動 URL（https のみ）" value={d.launchUrl} />
        <div className="form-row"><label htmlFor="f-integrationType">接続方式</label><select id="f-integrationType" name="integrationType" defaultValue={d.integrationType}><option value="external">外部サービス（別途ログインの可能性あり）</option><option value="sso_integrated">共通 SSO・権益チェック接入済み</option></select></div>
      </div>
      {props.showClientId ? <Field name="launchClientId" label="接入 client ID" value={d.launchClientId} hint="secret は Secret Manager の LAUNCH_CLIENT_SECRET_<ID> に登録" /> : <p className="small muted">接入 client ID：{d.launchClientId ?? "未発行（SSO 接入を希望する場合は運営が発行します）"}</p>}
      <div className="grid-2">
        <Field name="supportEmail" label="サポート連絡先" value={d.supportChannels.find((s) => s.type === "email")?.value} />
        <Field name="supportHours" label="受付時間" value={d.supportChannels.find((s) => s.type === "hours")?.value} />
        <Field name="termsUrl" label="利用規約 URL" value={d.termsUrl} />
        <Field name="privacyUrl" label="プライバシーポリシー URL" value={d.privacyUrl} />
        {props.providers && <Field name="version" label="バージョン" value={d.version} />}
      </div>
      {props.planRows && (
        <fieldset style={{ border: 0, padding: 0, margin: "8px 0 16px" }}>
          <legend style={{ fontWeight: 700 }}>料金プラン（審査後に反映）</legend>
          <p className="small muted">料金は税込・1空間あたり月額。公開後に料金や内容を変えると新しい版になり、既存の契約は申込時の条件のままです。</p>
          <input type="hidden" name="plan_count" value={rows.length} />
          <div className="stack">
            {rows.map((p, i) => (
              <div key={i} className="plan-card">
                <div className="grid-2">
                  <div className="form-row"><label>プランキー{p.key ? "" : "（新規の場合のみ入力）"}</label><input name={`plan_${i}_key`} type="text" defaultValue={p.key} readOnly={!!p.key} placeholder="standard" /></div>
                  <div className="form-row"><label>名称</label><input name={`plan_${i}_name`} type="text" defaultValue={p.name} /></div>
                  <div className="form-row"><label>料金種別</label><select name={`plan_${i}_priceType`} defaultValue={p.priceType}><option value="monthly">月額固定</option><option value="free">無料</option><option value="contact">要問い合わせ</option></select></div>
                  <div className="form-row"><label>月額（円）</label><input name={`plan_${i}_priceJpy`} type="number" min={0} defaultValue={p.priceJpy || ""} /></div>
                  <div className="form-row"><label>無料体験日数</label><input name={`plan_${i}_trialDays`} type="number" min={0} max={90} defaultValue={p.trialDays} /></div>
                  <div className="form-row"><label>制限</label><input name={`plan_${i}_limits`} type="text" defaultValue={p.limits} /></div>
                  <div className="form-row"><label>AI 従量単価（円 / 100万トークン、0 = なし）</label><input name={`plan_${i}_tokenPrice`} type="number" min={0} defaultValue={("tokenPrice" in p ? p.tokenPrice : 0) ?? 0} /></div>
                </div>
                <div className="form-row"><label>含まれる内容</label><textarea name={`plan_${i}_includes`} defaultValue={p.includes} /></div>
                <div className="row">
                  <label className="check"><input type="checkbox" name={`plan_${i}_ext`} defaultChecked={p.ext} />提供会社との別途契約が必要</label>
                  {p.key && <label className="check"><input type="checkbox" name={`plan_${i}_retire`} defaultChecked={"retire" in p && !!p.retire} />このプランの受付を終了</label>}
                </div>
              </div>
            ))}
          </div>
        </fieldset>
      )}
      <button className="btn btn-primary">{props.submitLabel}</button>
    </form>
  );
}
