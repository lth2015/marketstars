import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, randomToken } from "@/lib/session";
import { liveSubscription } from "@/lib/subscriptions";
import { priceLabel } from "@/lib/text";
import { addDays, formatJst } from "@/lib/time";
import { ApplyForm } from "@/components/ApplyForm";
import { t } from "@/lib/messages";

export const metadata = { title: "お申し込み内容の確認" };

export default async function ApplyPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ plan?: string; mode?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const s = await getSession();
  if (!s) redirect(`/auth/login?returnTo=${encodeURIComponent(`/apps/${slug}/apply${sp.plan ? `?plan=${sp.plan}&mode=${sp.mode ?? "start"}` : ""}`)}`);
  const app = await prisma.app.findUnique({ where: { slug }, include: { provider: true, plans: { where: { current: true }, orderBy: { sortOrder: "asc" } } } });
  if (!app || app.status !== "published") notFound();
  const live = s.tenantId ? await liveSubscription(s.tenantId, app.id) : null;
  const trialUsed = s.tenantId ? !!(await prisma.trialUsage.findUnique({ where: { tenantId_appId: { tenantId: s.tenantId, appId: app.id } } })) : true;

  const plan = app.plans.find((p) => p.id === sp.plan);
  const mode = sp.mode === "trial" ? "trial" : "start";

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="container" style={{ maxWidth: 860, paddingBottom: 64 }}>
      <div className="breadcrumb"><Link href={`/apps/${slug}`}>{app.name}</Link> ／ お申し込み</div>
      <h1 style={{ marginTop: 12 }}>お申し込み内容の確認</h1>
      {children}
    </div>
  );

  if (!s.isOwner) return <Shell><div className="alert alert-warn">お申し込みは空間「{s.tenantName}」のオーナーのみ可能です。オーナーにお申し込みをご依頼ください。</div></Shell>;
  if (live) return <Shell><div className="alert alert-info">この空間ではすでにお申し込み済み、または利用中です。<Link href={`/my/apps/${live.id}`}>契約内容を確認する</Link></div></Shell>;
  if (!app.acceptingNew) return <Shell><div className="alert alert-warn">現在、新規のお申し込みを受け付けていません。</div></Shell>;

  if (!plan) {
    return (
      <Shell>
        <p>申込先の空間：<strong>{s.tenantName}</strong>　<Link className="small" href={`/auth/switch?returnTo=${encodeURIComponent(`/apps/${slug}/apply`)}`}>空間を切り替える</Link></p>
        <div className="plan-grid">
          {app.plans.map((p) => {
            const canTrial = p.trialDays > 0 && p.priceType !== "free" && !trialUsed;
            return (
              <div key={p.id} className="plan-card stack">
                <h3>{p.name}</h3>
                <div className="price">{priceLabel(p)}</div>
                <p className="small muted" style={{ whiteSpace: "pre-line", margin: 0 }}>{p.includes}</p>
                {canTrial && <Link className="btn btn-primary btn-block" href={`?plan=${p.id}&mode=trial`}>{t.cta.trial(p.trialDays)}</Link>}
                <Link className={`btn ${canTrial ? "btn-secondary" : "btn-primary"} btn-block`} href={`?plan=${p.id}&mode=start`}>{p.priceType === "free" ? t.cta.free : "このプランを申し込む"}</Link>
              </div>
            );
          })}
        </div>
      </Shell>
    );
  }

  const isTrial = mode === "trial" && plan.trialDays > 0 && plan.priceType !== "free";
  if (mode === "trial" && (!isTrial || trialUsed)) {
    return <Shell><div className="alert alert-warn">この空間では無料体験をご利用いただけません（体験済み、または体験のないプラン）。<Link href={`/apps/${slug}/apply`}>プランを選び直す</Link></div></Shell>;
  }
  const paid = !isTrial && plan.priceType !== "free";
  const now = new Date();

  return (
    <Shell>
      <div className="panel stack">
        <dl className="dl">
          <dt>申込先の空間</dt><dd><strong>{s.tenantName}</strong>　<Link className="small" href={`/auth/switch?returnTo=${encodeURIComponent(`/apps/${slug}/apply?plan=${plan.id}&mode=${mode}`)}`}>切り替える</Link></dd>
          <dt>アプリ</dt><dd>{app.name}（{app.provider.name}）</dd>
          <dt>プラン</dt><dd>{plan.name}</dd>
          <dt>課金単位</dt><dd>1空間あたり／月</dd>
          <dt>料金</dt><dd><strong>{isTrial ? `無料体験中は ¥0（体験後：${priceLabel(plan)}）` : priceLabel(plan)}</strong></dd>
          {isTrial && <><dt>体験期間</dt><dd>{formatJst(now, true)} 〜 {formatJst(addDays(now, plan.trialDays), true)}（{plan.trialDays}日間）</dd></>}
          <dt>お支払い方法</dt><dd>{paid ? "請求書払い（銀行振込）※運営からご案内します" : "お支払いは発生しません"}</dd>
          <dt>処理の流れ</dt>
          <dd>
            {isTrial && "お申し込み後すぐに利用を開始できます。"}
            {!paid && !isTrial && "お申し込み後すぐに利用を開始できます。停止はいつでも可能です。"}
            {paid && "お申し込み後は「申込中」となります。運営が契約内容とお支払いを確認した時点で利用開始となり、その時刻から1か月が利用期間です。お申し込みはお支払い完了ではありません。"}
          </dd>
        </dl>
        {isTrial && <div className="alert alert-ok" style={{ margin: 0 }}>{t.noAutoCharge}</div>}
        {plan.externalContractRequired && <div className="alert alert-warn" style={{ margin: 0 }}>このプランは提供会社との別途契約が必要です。</div>}
        <ApplyForm appId={app.id} planVersionId={plan.id} expectedPriceJpy={plan.priceJpy} mode={isTrial ? "trial" : "start"} idempotencyKey={randomToken(18)} slug={slug}
          label={isTrial ? t.cta.trial(plan.trialDays) : paid ? "この内容で申し込む" : t.cta.free} paid={paid} />
      </div>
    </Shell>
  );
}
