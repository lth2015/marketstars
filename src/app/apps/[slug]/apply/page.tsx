import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, randomToken } from "@/lib/session";
import { liveSubscription } from "@/lib/subscriptions";
import { localizedPrice } from "@/lib/text";
import { addDays, formatJst } from "@/lib/time";
import { ApplyForm } from "@/components/ApplyForm";
import { getMessages } from "@/lib/messages";
import { getLink } from "@/lib/starpay";

export async function generateMetadata() {
  return { title: (await getMessages()).ui.apply.title };
}

export default async function ApplyPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ plan?: string; mode?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const t = await getMessages();
  const A = t.ui.apply;
  const priceLabel = (p: { priceType: string; priceJpy: number }) => localizedPrice(p, t.ui.price);
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
      <div className="breadcrumb"><Link href={`/apps/${slug}`}>{app.name}</Link> ／ {A.crumb}</div>
      <h1 style={{ marginTop: 12 }}>{A.title}</h1>
      {children}
    </div>
  );

  if (!s.isOwner) return <Shell><div className="alert alert-warn">{A.ownerOnly(s.tenantName ?? "")}</div></Shell>;
  if (live && (live.status === "trialing" || (live.status === "active" && live.kind === "free"))) redirect(`/my/apps/${live.id}#change`);
  if (live) return <Shell><div className="alert alert-info">{A.already}<Link href={`/my/apps/${live.id}`}>{A.seeContract}</Link></div></Shell>;
  if (!app.acceptingNew) return <Shell><div className="alert alert-warn">{A.notAccepting}</div></Shell>;

  if (!plan) {
    return (
      <Shell>
        <p>{A.targetSpace}：<strong>{s.tenantName}</strong>　<a className="small" href={`/auth/switch?returnTo=${encodeURIComponent(`/apps/${slug}/apply`)}`}>{A.switchSpace}</a></p>
        <div className="plan-grid">
          {app.plans.map((p) => {
            const canTrial = p.trialDays > 0 && p.priceType !== "free" && !trialUsed;
            return (
              <div key={p.id} className="plan-card stack">
                <h2 style={{ fontSize: 18, margin: 0 }}>{p.name}</h2>
                <div className="price">{priceLabel(p)}</div>
                <p className="small muted" style={{ whiteSpace: "pre-line", margin: 0 }}>{p.includes}</p>
                {canTrial && <Link className="btn btn-primary btn-block" href={`?plan=${p.id}&mode=trial`}>{t.cta.trial(p.trialDays)}</Link>}
                <Link className={`btn ${canTrial ? "btn-secondary" : "btn-primary"} btn-block`} href={`?plan=${p.id}&mode=start`}>{p.priceType === "free" ? t.cta.free : A.applyPlan}</Link>
              </div>
            );
          })}
        </div>
      </Shell>
    );
  }

  const isTrial = mode === "trial" && plan.trialDays > 0 && plan.priceType !== "free";
  if (mode === "trial" && (!isTrial || trialUsed)) {
    return <Shell><div className="alert alert-warn">{A.noTrial}<Link href={`/apps/${slug}/apply`}>{A.choosePlanAgain}</Link></div></Shell>;
  }
  const paid = !isTrial && plan.priceType !== "free";
  const starpayMerchant = paid && plan.priceType === "monthly" ? (await getLink(s.tenantId))?.merchantId ?? null : null;
  const now = new Date();

  return (
    <Shell>
      <div className="panel stack">
        <dl className="dl">
          <dt>{A.targetSpace}</dt><dd><strong>{s.tenantName}</strong>　<a className="small" href={`/auth/switch?returnTo=${encodeURIComponent(`/apps/${slug}/apply?plan=${plan.id}&mode=${mode}`)}`}>{A.switchShort}</a></dd>
          <dt>{A.app}</dt><dd>{app.name}（{app.provider.name}）</dd>
          <dt>{A.plan}</dt><dd>{plan.name}</dd>
          <dt>{A.unit}</dt><dd>{A.unitValue}</dd>
          <dt>{A.price}</dt><dd><strong>{isTrial ? A.trialPrice(priceLabel(plan)) : priceLabel(plan)}</strong></dd>
          {isTrial && <><dt>{A.trialPeriod}</dt><dd>{formatJst(now, true)} 〜 {formatJst(addDays(now, plan.trialDays), true)}（{A.days(plan.trialDays)}）</dd></>}
          <dt>{A.payment}</dt><dd>{paid ? A.paymentPaid : A.paymentNone}</dd>
          <dt>{A.flow}</dt>
          <dd>
            {isTrial && A.flowTrial}
            {!paid && !isTrial && A.flowFree}
            {paid && A.flowPaid}
          </dd>
        </dl>
        {isTrial && <div className="alert alert-ok" style={{ margin: 0 }}>{t.noAutoCharge}</div>}
        {plan.externalContractRequired && <div className="alert alert-warn" style={{ margin: 0 }}>{A.externalContract}</div>}
        <ApplyForm appId={app.id} planVersionId={plan.id} expectedPriceJpy={plan.priceJpy} mode={isTrial ? "trial" : "start"} idempotencyKey={randomToken(18)} slug={slug}
          label={isTrial ? t.cta.trial(plan.trialDays) : paid ? A.submitPaid : t.cta.free} paid={paid} labels={A.form} starpayLabel={starpayMerchant ? A.payStarpay(starpayMerchant) : null} />
      </div>
    </Shell>
  );
}
