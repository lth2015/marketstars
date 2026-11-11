import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { isEntitled } from "@/lib/subscriptions";
import { formatJst } from "@/lib/time";
import { yen } from "@/lib/text";
import { StatusBadge } from "@/components/StatusBadge";
import { subscriptionAction } from "@/app/actions";

export const metadata = { title: "契約内容" };

export default async function ContractPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; error?: string; done?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const s = await getSession();
  if (!s) redirect(`/auth/login?returnTo=/my/apps/${id}`);
  // 租户隔离：仅当前已验证空间内的记录
  const sub = await prisma.subscription.findFirst({ where: { id, tenantId: s.tenantId ?? "__none__" }, include: { app: { include: { plans: { where: { current: true } } } }, request: true, periods: { orderBy: { startsAt: "desc" } } } });
  if (!sub) notFound();
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
          {sub.request && <><dt>同意した規約</dt><dd>版 {sub.request.termsVersion}（{formatJst(sub.request.agreedAt, true)}）</dd></>}
        </dl>
        {ok && <div style={{ marginTop: 16 }}><Link className="btn btn-primary" href={`/launch/${sub.id}`}>アプリを開く</Link></div>}
      </div>

      <h2 style={{ marginTop: 32 }}>契約の管理</h2>
      <div className="stack">
        {sub.status === "pending" && <Action op="withdraw" label="お申し込みを取り下げる" confirm="お申し込みを取り下げます。後から再度お申し込みできます。" variant="btn-danger" />}
        {sub.status === "trialing" && (
          <>
            <div className="panel"><p className="small" style={{ marginTop: 0 }}>体験終了後に自動で課金されることはありません。続けて利用する場合は有料プランをお申し込みください（体験終了後でもお申し込みできます）。</p><Link className="btn btn-primary btn-sm" href={`/apps/${sub.app.slug}/apply`}>有料プランを申し込む</Link></div>
            <Action op="end_trial" label="無料体験を今すぐ終了する" confirm="すぐに利用できなくなります。同じ空間で同じアプリの無料体験は再度利用できません。" variant="btn-danger" />
          </>
        )}
        {sub.status === "active" && sub.kind === "free" && <Action op="cancel" label="利用を停止する" confirm="すぐに利用できなくなります。アカウントは削除されません。アプリに保存したデータの扱いは提供会社にお問い合わせください。" variant="btn-danger" />}
        {sub.status === "active" && sub.kind === "paid" && <Action op="cancel" label="期間終了時に解約する" confirm={`${formatJst(sub.currentPeriodEnd, true)} に解約されます。それまでは引き続き利用できます。日割り返金はありません。`} variant="btn-danger" />}
        {sub.status === "cancel_scheduled" && <Action op="undo_cancel" label="解約を取り消す" confirm="解約予定を取り消し、契約を継続します。次の期間は入金確認後に延長されます。" />}
        {["expired", "canceled", "rejected", "withdrawn"].includes(sub.status) && <div className="panel"><p className="small" style={{ marginTop: 0 }}>この契約は終了しています。</p><Link className="btn btn-primary btn-sm" href={`/apps/${sub.app.slug}`}>アプリ詳細へ</Link></div>}
      </div>

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
