import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { developerApp } from "@/lib/developer";
import { draftFromApp } from "@/lib/publishing";
import { AppDraftEditor } from "@/components/AppDraftEditor";
import { Flash } from "@/components/Flash";
import { Stars } from "@/components/Stars";
import { formatJst } from "@/lib/time";
import { priceLabel } from "@/lib/text";
import { devReplyAction, devSaveDraftAction, devSubmitAction, hostingAction, webhookAction } from "../../actions";
import { hostedEntry, LIMITS } from "@/lib/hosting";
import { webhookSecret } from "@/lib/webhooks";
import { WEBHOOK_EVENT_TYPES } from "@/lib/events";

export default async function DevApp({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const s = await getSession();
  if (!s) redirect(`/auth/login?returnTo=/developer/apps/${id}`);
  const own = await developerApp(s, id);
  if (!own) notFound();
  const app = await prisma.app.findUniqueOrThrow({ where: { id }, include: { categories: true, industries: true, integrationTags: true, plans: { where: { current: true }, orderBy: { sortOrder: "asc" } } } });
  const [endpoints, cats, inds, integs, reviews, live] = await Promise.all([
    prisma.webhookEndpoint.findMany({ where: { appId: id }, include: { deliveries: { include: { event: { select: { type: true } } }, orderBy: { createdAt: "desc" }, take: 10 } }, orderBy: { createdAt: "asc" } }),
    prisma.category.findMany({ orderBy: { sortOrder: "asc" } }), prisma.industry.findMany({ orderBy: { sortOrder: "asc" } }), prisma.integrationTag.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.review.findMany({ where: { appId: id }, orderBy: { createdAt: "desc" } }),
    prisma.subscription.groupBy({ by: ["status"], where: { appId: id, internalTest: false, liveKey: { not: null } }, _count: true }),
  ]);
  const builds = await prisma.hostedBuild.findMany({ where: { appId: id }, orderBy: { number: "desc" }, take: 20 });
  const liveNumber = app.hostedBuildId ? (await prisma.hostedBuild.findUnique({ where: { id: app.hostedBuildId }, select: { number: true } }))?.number ?? 0 : 0;
  const hosted = app.integrationType === "hosted" || (app.draft as { integrationType?: string } | null)?.integrationType === "hosted" || builds.length > 0;
  const d = draftFromApp(app, app.plans);
  if (!d.plans) d.plans = app.plans.map((p) => ({ key: p.planKey, name: p.name, priceType: p.priceType as "free", priceJpy: p.priceJpy, trialDays: p.trialDays, includes: p.includes, limits: p.limits, ext: p.externalContractRequired, sortOrder: p.sortOrder, tokenPrice: p.tokenPriceJpyPerMTok }));
  const submitted = app.reviewStatus === "submitted";
  return (
    <div className="container" style={{ maxWidth: 1000, paddingBottom: 64 }}>
      <div className="breadcrumb"><Link href="/developer">開発者ポータル</Link> ／ {app.name}</div>
      <div className="section-head" style={{ marginTop: 12 }}>
        <div><h1 style={{ margin: 0 }}>{app.name}</h1><div className="small muted">{app.slug} ・ {app.status === "published" ? "公開中" : "未公開"} <Stars value={app.ratingAvg} count={app.ratingCount} /></div></div>
        {app.draft && <Link className="btn btn-secondary btn-sm" href={`/apps/${app.slug}?preview=1`} target="_blank">下書きをプレビュー</Link>}
      </div>
      <Flash msg={sp.msg} error={sp.error} />
      <div className="panel stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <strong>審査：</strong>{submitted ? `審査中（${formatJst(app.submittedAt, true)} 提出）` : app.reviewStatus === "rejected" ? "差し戻し" : app.reviewStatus === "approved" ? "承認済み" : "未提出"}
            {app.reviewStatus === "rejected" && app.reviewNote && <div className="alert alert-warn small" style={{ margin: "8px 0 0" }}>運営からのコメント：{app.reviewNote}</div>}
          </div>
          <form action={devSubmitAction} className="row">
            <input type="hidden" name="id" value={id} />
            {submitted ? <><input type="hidden" name="op" value="withdraw" /><button className="btn btn-ghost btn-sm">提出を取り下げる</button></> : <button className="btn btn-primary btn-sm" disabled={!app.draft || !s.isOwner}>審査に提出</button>}
          </form>
        </div>
        <p className="small muted" style={{ margin: 0 }}>公開中のアプリを編集した場合も、審査で承認されるまでは公開中の内容は変わりません。料金プランの変更は承認後に新しい版として反映されます。</p>
        {live.length > 0 && <p className="small" style={{ margin: 0 }}>利用状況：{live.map((x) => `${x.status} ${x._count}`).join("・")}</p>}
      </div>

      {app.plans.length > 0 && (
        <div className="panel small" style={{ marginTop: 16 }}><strong>公開中の料金プラン：</strong>{app.plans.map((p) => `${p.name}（${priceLabel(p)}${p.trialDays ? `・体験${p.trialDays}日` : ""}）`).join("、")}</div>
      )}

      <div style={{ marginTop: 16 }}>
        {submitted ? <div className="alert alert-info">審査中のため編集できません。</div> : (
          <AppDraftEditor action={devSaveDraftAction} id={id} draft={d} cats={cats} inds={inds} integs={integs} showClientId={false} planRows submitLabel="下書きを保存" note="保存後「審査に提出」してください。" />
        )}
      </div>


      {hosted && (
        <section id="hosting" style={{ marginTop: 40 }}>
          <h2>ホスティング（静的サイト）</h2>
          <p className="small muted">HTML・CSS・JavaScript・画像をまとめた zip をアップロードすると、MarketStars が検証（ビルド）して配信します。サーバー側のコードは実行しません。画面を開くたびに、利用中の空間の契約を MarketStars が確認します。上限：zip {LIMITS.zipBytes / 1024 / 1024}MB・{LIMITS.files} ファイル・1ファイル {LIMITS.fileBytes / 1024 / 1024}MB。ルートに index.html が必要です。</p>
          {s.isOwner && (
            <form action={hostingAction} className="panel stack">
              <input type="hidden" name="appId" value={id} /><input type="hidden" name="op" value="upload" />
              <div className="form-row" style={{ margin: 0 }}><label htmlFor="h-zip">zip ファイル</label><input id="h-zip" name="zip" type="file" accept=".zip,application/zip" required /></div>
              <label className="check"><input type="checkbox" name="autoDeploy" /> ビルドに成功したら本番に自動で反映する</label>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <button className="btn btn-primary btn-sm">アップロードしてビルド</button>
                <span className="small">お試し用：<a href="/developer/hosting-sample">サンプル zip（v1.0.0）</a>・<a href="/developer/hosting-sample?v=1.1.0">v1.1.0</a></span>
              </div>
            </form>
          )}
          {builds.length === 0 ? <div className="empty small" style={{ marginTop: 12 }}>まだビルドはありません。</div> : (
            <div className="table-wrap" style={{ marginTop: 12 }}><table className="table" data-testid="builds"><thead><tr><th>ビルド</th><th>状態</th><th>ファイル</th><th>日時</th><th></th></tr></thead><tbody>
              {builds.map((b) => {
                const live = app.hostedBuildId === b.id;
                const log = b.log as { ok: boolean; msg: string }[];
                return (
                  <tr key={b.id} data-build={b.number}>
                    <td><strong>#{b.number}</strong>{live && <span className="badge" style={{ marginLeft: 8 }}>本番</span>}
                      <details><summary className="small">ログ</summary><ul className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>{log.map((l, i) => <li key={i} style={{ color: l.ok ? undefined : "var(--danger, #B42318)" }}>{l.ok ? "✓" : "✗"} {l.msg}</li>)}</ul></details></td>
                    <td className="small">{b.status === "ready" ? "成功" : b.status === "failed" ? "失敗" : "ビルド中"}</td>
                    <td className="small">{b.fileCount} 件・{(b.totalBytes / 1024).toFixed(1)}KB</td>
                    <td className="small">{formatJst(b.createdAt, true)}</td>
                    <td><div className="row" style={{ justifyContent: "flex-end" }}>
                      {b.status === "ready" && <a className="btn btn-ghost btn-sm" href={hostedEntry(app.slug, b.id)} target="_blank" rel="noopener">プレビュー</a>}
                      {b.status === "ready" && !live && s.isOwner && (
                        <form action={hostingAction}><input type="hidden" name="appId" value={id} /><input type="hidden" name="op" value="deploy" /><input type="hidden" name="buildId" value={b.id} />
                          {liveNumber > b.number && <input type="hidden" name="rollback" value="1" />}
                          <button className="btn btn-secondary btn-sm">{liveNumber > b.number ? "この版に戻す" : "本番に反映"}</button></form>
                      )}
                    </div></td>
                  </tr>
                );
              })}
            </tbody></table></div>
          )}
          {app.status === "published" && app.integrationType === "hosted" && app.hostedBuildId && <p className="small muted">本番の反映は審査なしで即時に切り替わります（アプリ情報・料金の変更は従来どおり審査が必要です）。問題があれば「この版に戻す」で前のビルドに戻せます。</p>}
        </section>
      )}

      <section id="webhooks" style={{ marginTop: 40 }}>
        <h2>Webhook（契約イベントの通知）</h2>
        <p className="small muted">利用開始・解約・支払いなどのイベントを、提供会社のサーバーへ署名付きで送信します。失敗時は 1分→5分→30分→2時間→12時間 の間隔で再試行します。受信側は <code>X-MarketStars-Signature</code>（<code>t=時刻,v1=HMAC-SHA256(secret, &quot;時刻.本文&quot;)</code>）を検証し、5分以上古いものは拒否してください。</p>
        {endpoints.map((e) => (
          <div key={e.id} className="panel stack" style={{ marginBottom: 12 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div><code style={{ wordBreak: "break-all" }}>{e.url}</code><div className="small muted">{e.enabled ? "有効" : "停止中"} ・ イベント：{e.eventTypes === "*" ? "すべて" : e.eventTypes.split(",").join("、")}</div></div>
              <div className="row">
                {(["test", "toggle", "delete"] as const).map((op) => (
                  <form key={op} action={webhookAction}><input type="hidden" name="appId" value={id} /><input type="hidden" name="endpointId" value={e.id} /><input type="hidden" name="op" value={op} />
                    <button className={`btn btn-sm ${op === "delete" ? "btn-danger" : "btn-secondary"}`} disabled={!s.isOwner}>{op === "test" ? "テスト送信" : op === "toggle" ? (e.enabled ? "停止" : "再開") : "削除"}</button></form>
                ))}
              </div>
            </div>
            {s.isOwner && <details><summary className="small">署名シークレットを表示</summary><code className="small" style={{ wordBreak: "break-all" }}>{webhookSecret(e.id)}</code></details>}
            {e.deliveries.length > 0 && (
              <div className="table-wrap"><table className="table"><thead><tr><th>日時</th><th>イベント</th><th>結果</th><th>試行</th><th></th></tr></thead><tbody>
                {e.deliveries.map((d) => (
                  <tr key={d.id}><td className="small">{formatJst(d.createdAt, true)}</td><td className="small">{d.event.type}</td>
                    <td className="small">{d.status === "succeeded" ? `成功（${d.lastStatus}）` : d.status === "dead" ? "停止（再試行上限）" : d.status === "pending" ? "送信待ち" : `失敗：${d.lastError ?? ""}`}</td><td>{d.attempts}</td>
                    <td>{d.status !== "succeeded" && <form action={webhookAction}><input type="hidden" name="appId" value={id} /><input type="hidden" name="endpointId" value={e.id} /><input type="hidden" name="op" value="redeliver" /><input type="hidden" name="deliveryId" value={d.id} /><button className="btn btn-ghost btn-sm">再送</button></form>}</td></tr>
                ))}
              </tbody></table></div>
            )}
          </div>
        ))}
        {s.isOwner && (
          <form action={webhookAction} className="panel">
            <input type="hidden" name="appId" value={id} /><input type="hidden" name="op" value="create" />
            <div className="form-row"><label htmlFor="wh-url">送信先 URL（https）</label><input id="wh-url" name="url" type="url" required placeholder="https://example.com/marketstars/webhook" /></div>
            <fieldset className="form-row" style={{ border: 0, padding: 0 }}><legend style={{ fontWeight: 600, fontSize: 14 }}>イベント</legend>
              <div className="row"><label className="check"><input type="checkbox" name="eventTypes" value="*" defaultChecked /> すべて</label>
                {WEBHOOK_EVENT_TYPES.map((t) => <label key={t} className="check small"><input type="checkbox" name="eventTypes" value={t} /> {t}</label>)}</div></fieldset>
            <button className="btn btn-primary btn-sm">Webhook を追加</button>
          </form>
        )}
      </section>

      <h2 style={{ marginTop: 40 }}>レビュー</h2>
      {reviews.length === 0 ? <div className="empty small">まだレビューはありません。</div> : reviews.map((r) => (
        <div key={r.id} className="panel" style={{ marginBottom: 12 }}>
          <div className="row" style={{ justifyContent: "space-between" }}><Stars value={r.rating} count={1} /><span className="small muted">{formatJst(r.createdAt)}{r.status === "hidden" ? " ・ 非表示（運営）" : ""}</span></div>
          <strong>{r.title}</strong><p style={{ whiteSpace: "pre-line", margin: "4px 0 8px" }}>{r.body}</p>
          <form action={devReplyAction} className="row"><input type="hidden" name="id" value={r.id} /><input name="reply" defaultValue={r.replyBody ?? ""} placeholder="提供会社として返信" style={{ flex: 1, minWidth: 200, height: 36, border: "1px solid var(--border)", borderRadius: 8, padding: "0 10px" }} /><button className="btn btn-secondary btn-sm">返信を保存</button></form>
        </div>
      ))}
    </div>
  );
}
