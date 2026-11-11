import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { isEntitled } from "@/lib/subscriptions";
import { formatJst } from "@/lib/time";
import { yen } from "@/lib/text";
import { StatusBadge } from "@/components/StatusBadge";
import { autoRenewAction, planChangeAction, subscriptionAction, usageCapAction } from "@/app/actions";
import { jstMonth, monthUsage } from "@/lib/usage";
import { priceLabel } from "@/lib/text";

export const metadata = { title: "契約内容" };

export default async function ContractPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; error?: string; done?: string; paid?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const s = await getSession();
  if (!s) redirect(`/auth/login?returnTo=/my/apps/${id}`);
  // 租户隔离：仅当前已验证空间内的记录
  const sub = await prisma.subscription.findFirst({ where: { id, tenantId: s.tenantId ?? "__none__" }, include: { app: { include: { plans: { where: { current: true }, orderBy: { sortOrder: "asc" } } } }, request: true, periods: { orderBy: { startsAt: "desc" } }, scheduledPlan: true, paymentMethod: true, paymentIntents: { where: { status: { in: ["requires_payment", "failed"] }, purpose: { in: ["activate", "convert_trial", "upgrade"] } }, orderBy: { createdAt: "desc" }, take: 1 } } });
  const cards = s.isOwner ? await prisma.paymentMethod.findMany({ where: { tenantId: s.tenantId!, active: true } }) : [];
  if (!sub) notFound();
  const usageMonth = jstMonth();
  const usage = await monthUsage(sub.id, usageMonth);
  const unitPrice = (await prisma.planVersion.findUniqueOrThrow({ where: { id: sub.planVersionId } })).tokenPriceJpyPerMTok;
  const ok = isEntitled(sub);
  const Action = ({ op, label, confirm, variant = "btn-secondary" }: { op: string; label: string; confirm: string; variant?: string }) => (
    <form action={subscriptionAction} className="panel stack" style={{ background: "#FBFCFD" }}>
      <input type="hidden" name="id" value={sub.id} />
      <input type="hidden" name="op" value={op} />
      <p className="small" style={{ margin: 0 }}>{confirm}</p>
      <div><button className={`btn ${variant} btn-sm`} disabled={!s.isOwner}>{label}</button>{!s.isOwner && <span className="small muted">　オーナーのみ操作できます</span>}</div>
    </form>
  );

  return (
    <div className="container" style={{ maxWidth: 860, paddingBottom: 64 }}>
      <div className="breadcrumb"><Link href="/my/apps">マイアプリ</Link> ／ {sub.app.name}</div>
      <h1 style={{ marginTop: 12 }}>{sub.app.name}</h1>
      {sp.done && sub.status === "pending" && <div className="alert alert-info">お申し込みを受け付けました（まだお支払いは完了していません）。運営が契約内容とお支払い方法をご案内し、確認後に利用開始となります。</div>}
      {sp.done && sub.status !== "pending" && <div className="alert alert-ok">利用を開始しました。「アプリを開く」からご利用ください。</div>}
      {sp.paid && <div className="alert alert-ok">お支払いが完了しました。{sub.autoRenew ? "次回からは期間終了の前日に自動で更新されます。" : ""}</div>}
      {sub.lastChargeError && sub.liveKey && <div className="alert alert-error">自動更新のお支払いに失敗しました：{sub.lastChargeError}。期間終了までにカードを変更するか、お問い合わせください。<Link href="/my/billing">支払い方法を管理</Link></div>}
      {sub.paymentIntents[0] && (sub.status === "pending" || sub.scheduledPlanVersionId) && <div className="alert alert-warn">カードでのお支払いが完了していません。<Link href={`/pay/${sub.paymentIntents[0].id}`}>お支払いへ進む</Link></div>}
      {sp.msg && <div className="alert alert-ok">{sp.msg}</div>}
      {sp.error && <div className="alert alert-error" role="alert">{sp.error}</div>}
      {sub.status === "suspended" && <div className="alert alert-error">運営によりこのアプリの利用を一時停止しています。理由：{sub.suspendedReason}　<Link href={`/contact?app=${sub.app.slug}`}>サポートへ問い合わせる</Link></div>}

      <div className="panel">
        <dl className="dl">
          <dt>状態</dt><dd><StatusBadge status={sub.status} /></dd>
          <dt>空間</dt><dd>{sub.tenantName}</dd>
          <dt>プラン</dt><dd>{sub.planNameSnapshot}</dd>
          <dt>料金（申込時点）</dt><dd>{sub.kind === "trial" ? "無料体験" : sub.priceJpySnapshot === 0 ? "無料" : `${yen(sub.priceJpySnapshot)}／月（税込）・1空間あたり`}</dd>
          {sub.startedAt && <><dt>利用開始</dt><dd>{formatJst(sub.startedAt, true)}</dd></>}
          {sub.trialEndsAt && <><dt>体験終了</dt><dd>{formatJst(sub.trialEndsAt, true)}</dd></>}
          {sub.kind === "paid" && sub.currentPeriodEnd && <><dt>現在の利用期間</dt><dd>{formatJst(sub.currentPeriodStart, true)} 〜 {formatJst(sub.currentPeriodEnd, true)}</dd></>}
          {sub.cancelAt && <><dt>解約日</dt><dd>{formatJst(sub.cancelAt, true)}（この日時まで利用できます）</dd></>}
          {sub.kind === "paid" && <><dt>お支払い</dt><dd>{sub.paymentMode === "card" ? `カード${sub.paymentMethod ? `（${sub.paymentMethod.brand} •••• ${sub.paymentMethod.last4}）` : ""}` : "請求書払い"}{sub.status !== "pending" && ` ・ 自動更新：${sub.autoRenew ? "オン" : "オフ"}`}</dd></>}
          {sub.scheduledPlan && <><dt>{sub.status === "trialing" ? "切り替え申込中" : "次の期間から"}</dt><dd>{sub.scheduledPlan.name}（{priceLabel(sub.scheduledPlan)}）</dd></>}
          {sub.request && <><dt>同意した規約</dt><dd>版 {sub.request.termsVersion}（{formatJst(sub.request.agreedAt, true)}）</dd></>}
        </dl>
        {ok && <div style={{ marginTop: 16 }}><Link className="btn btn-primary" href={`/launch/${sub.id}`}>アプリを開く</Link></div>}
      </div>

      <h2 style={{ marginTop: 32 }}>契約の管理</h2>
      <div className="stack">
        {sub.status === "pending" && <Action op="withdraw" label="お申し込みを取り下げる" confirm="お申し込みを取り下げます。後から再度お申し込みできます。" variant="btn-danger" />}
        {sub.status === "trialing" && (
          <>
            <div className="panel"><p className="small" style={{ marginTop: 0 }}>体験終了後に自動で課金されることはありません。続けて利用する場合は有料プランをお申し込みください（体験終了後でもお申し込みできます）。</p><a className="btn btn-primary btn-sm" href="#change">有料プランに切り替える</a></div>
            <Action op="end_trial" label="無料体験を今すぐ終了する" confirm="すぐに利用できなくなります。同じ空間で同じアプリの無料体験は再度利用できません。" variant="btn-danger" />
          </>
        )}
        {sub.status === "active" && sub.kind === "free" && <Action op="cancel" label="利用を停止する" confirm="すぐに利用できなくなります。アカウントは削除されません。アプリに保存したデータの扱いは提供会社にお問い合わせください。" variant="btn-danger" />}
        {sub.status === "active" && sub.kind === "paid" && <Action op="cancel" label="期間終了時に解約する" confirm={`${formatJst(sub.currentPeriodEnd, true)} に解約されます。それまでは引き続き利用でき、自動更新の請求も行いません。日割り返金はありません。`} variant="btn-danger" />}
        {sub.status === "cancel_scheduled" && <Action op="undo_cancel" label="解約を取り消す" confirm="解約予定を取り消し、契約を継続します。次の期間は入金確認後に延長されます。" />}
        {["expired", "canceled", "rejected", "withdrawn"].includes(sub.status) && <div className="panel"><p className="small" style={{ marginTop: 0 }}>この契約は終了しています。</p><Link className="btn btn-primary btn-sm" href={`/apps/${sub.app.slug}`}>アプリ詳細へ</Link></div>}
      </div>


      {(unitPrice > 0 || usage.requests > 0) && (
        <section style={{ marginTop: 32 }}>
          <h2>AI モデル利用量（{usageMonth.key}）</h2>
          <div className="panel stack">
            <dl className="dl">
              <dt>リクエスト数</dt><dd>{usage.requests.toLocaleString()}</dd>
              <dt>トークン</dt><dd>入力 {usage.inputTokens.toLocaleString()} ／ 出力 {usage.outputTokens.toLocaleString()}</dd>
              <dt>単価</dt><dd>{unitPrice > 0 ? `¥${unitPrice.toLocaleString()} / 100万トークン` : "従量課金なし"}</dd>
              <dt>今月の従量料金（見込み）</dt><dd><strong>¥{usage.costJpy.toLocaleString()}</strong>（税込・月末締めで翌月に請求）</dd>
              <dt>月の利用上限</dt><dd>{sub.usageCapJpy === null ? "なし" : `¥${sub.usageCapJpy.toLocaleString()}（到達するとAI機能が停止します）`}</dd>
            </dl>
            {s.isOwner && unitPrice > 0 && (
              <form action={usageCapAction} className="row">
                <input type="hidden" name="id" value={sub.id} />
                <label className="small" htmlFor="cap">上限額（円・空欄で解除）</label>
                <input id="cap" name="cap" type="number" min={0} defaultValue={sub.usageCapJpy ?? ""} style={{ width: 120, height: 34 }} />
                <button className="btn btn-secondary btn-sm">保存</button>
              </form>
            )}
          </div>
        </section>
      )}

      {s.isOwner && ["active", "trialing"].includes(sub.status) && (() => {
        const others = sub.app.plans.filter((p) => (sub.status === "trialing" || p.id !== sub.planVersionId) && p.priceType !== "contact" && (sub.kind === "paid" || p.priceType === "monthly"));
        if (!others.length && !sub.scheduledPlan) return null;
        return (
          <section id="change" style={{ marginTop: 32 }}>
            <h2>プランの変更</h2>
            {sub.scheduledPlan ? (
              <form action={planChangeAction} className="panel row" style={{ justifyContent: "space-between" }}>
                <input type="hidden" name="id" value={sub.id} /><input type="hidden" name="op" value="cancel_change" />
                <span className="small">{sub.status === "trialing" ? `「${sub.scheduledPlan.name}」への切り替えを申込中です。` : `${formatJst(sub.currentPeriodEnd, true)} から「${sub.scheduledPlan.name}」に変更されます。`}</span>
                <button className="btn btn-ghost btn-sm">変更を取り消す</button>
              </form>
            ) : (
              <>
                <p className="small muted">{sub.kind === "paid" ? "変更は現在の利用期間の終了時に反映されます（日割りはありません）。" : sub.status === "trialing" ? "カード払いならすぐに有料プランへ切り替わります。請求書払いは無料体験期間内に運営の入金確認が必要です。" : "カード払いでお支払い後、すぐに切り替わります。"}</p>
                <div className="plan-grid">
                  {others.map((p) => (
                    <form key={p.id} action={planChangeAction} className="plan-card stack">
                      <input type="hidden" name="id" value={sub.id} /><input type="hidden" name="planVersionId" value={p.id} /><input type="hidden" name="expectedPriceJpy" value={p.priceJpy} />
                      <h3 style={{ margin: 0 }}>{p.name}</h3>
                      <div className="price">{priceLabel(p)}</div>
                      <p className="small muted" style={{ whiteSpace: "pre-line", margin: 0 }}>{p.includes}</p>
                      {sub.status === "trialing" && (
                        <div className="small">
                          <label className="check"><input type="radio" name="payment" value="card" defaultChecked /> カード（すぐに切り替え）</label>
                          <label className="check"><input type="radio" name="payment" value="invoice" /> 請求書払い</label>
                        </div>
                      )}
                      <button className="btn btn-secondary btn-sm">{sub.kind === "paid" ? "次の期間からこのプランにする" : "このプランに切り替える"}</button>
                    </form>
                  ))}
                </div>
              </>
            )}
          </section>
        );
      })()}

      {s.isOwner && sub.kind === "paid" && ["active", "cancel_scheduled"].includes(sub.status) && (
        <section style={{ marginTop: 32 }}>
          <h2>自動更新</h2>
          <div className="panel stack">
            {sub.autoRenew ? (
              <form action={autoRenewAction} className="row" style={{ justifyContent: "space-between" }}>
                <input type="hidden" name="id" value={sub.id} /><input type="hidden" name="on" value="0" />
                <span className="small">期間終了の前日に {sub.paymentMethod ? `${sub.paymentMethod.brand} •••• ${sub.paymentMethod.last4}` : "登録カード"} へ請求し、1か月延長します。</span>
                <button className="btn btn-ghost btn-sm">自動更新を停止</button>
              </form>
            ) : cards.length ? (
              <form action={autoRenewAction} className="row">
                <input type="hidden" name="id" value={sub.id} /><input type="hidden" name="on" value="1" />
                <select name="paymentMethodId" aria-label="カード" style={{ height: 34 }}>{cards.map((c) => <option key={c.id} value={c.id}>{c.brand} •••• {c.last4}</option>)}</select>
                <button className="btn btn-secondary btn-sm">このカードで自動更新する</button>
              </form>
            ) : <p className="small" style={{ margin: 0 }}>自動更新にはカードの登録が必要です。<Link href="/my/billing">支払い方法を登録</Link></p>}
            {sub.autoRenew && cards.length > 1 && (
              <form action={autoRenewAction} className="row">
                <input type="hidden" name="id" value={sub.id} /><input type="hidden" name="on" value="1" />
                <select name="paymentMethodId" aria-label="カード" defaultValue={sub.paymentMethodId ?? ""} style={{ height: 34 }}>{cards.map((c) => <option key={c.id} value={c.id}>{c.brand} •••• {c.last4}</option>)}</select>
                <button className="btn btn-ghost btn-sm">カードを変更</button>
              </form>
            )}
          </div>
        </section>
      )}

      {sub.periods.length > 0 && (
        <>
          <h2 style={{ marginTop: 32 }}>利用期間の履歴</h2>
          <div className="table-wrap"><table className="table"><thead><tr><th>種別</th><th>開始</th><th>終了</th></tr></thead><tbody>
            {sub.periods.map((p) => <tr key={p.id}><td>{p.kind === "paid" ? "有料" : p.kind === "trial" ? "無料体験" : "無料"}</td><td>{formatJst(p.startsAt, true)}</td><td>{formatJst(p.endsAt, true)}</td></tr>)}
          </tbody></table></div>
        </>
      )}
    </div>
  );
}
