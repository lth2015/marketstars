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
import { localizedPrice } from "@/lib/text";
import { getMessages } from "@/lib/messages";

export async function generateMetadata() {
  return { title: (await getMessages()).ui.contract.title };
}

export default async function ContractPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; error?: string; done?: string; paid?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const t = await getMessages();
  const C = t.ui.contract;
  const priceLabel = (p: { priceType: string; priceJpy: number }) => localizedPrice(p, t.ui.price);
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
      <div><button className={`btn ${variant} btn-sm`} disabled={!s.isOwner}>{label}</button>{!s.isOwner && <span className="small muted">　{C.ownerOnly}</span>}</div>
    </form>
  );

  return (
    <div className="container" style={{ maxWidth: 860, paddingBottom: 64 }}>
      <div className="breadcrumb"><Link href="/my/apps">{t.ui.myApps.title}</Link> ／ {sub.app.name}</div>
      <h1 style={{ marginTop: 12 }}>{sub.app.name}</h1>
      {sp.done && sub.status === "pending" && <div className="alert alert-info">{C.donePending}</div>}
      {sp.done && sub.status !== "pending" && <div className="alert alert-ok">{C.doneActive}</div>}
      {sp.paid && <div className="alert alert-ok">{C.paid}{sub.autoRenew ? C.paidRenew : ""}</div>}
      {sub.lastChargeError && sub.liveKey && <div className="alert alert-error">{C.chargeFailed(sub.lastChargeError)}<Link href="/my/billing">{C.manageCards}</Link></div>}
      {sub.paymentIntents[0] && (sub.status === "pending" || sub.scheduledPlanVersionId) && <div className="alert alert-warn">{C.payIncomplete}<Link href={`/pay/${sub.paymentIntents[0].id}`}>{C.goPay}</Link></div>}
      {sp.msg && <div className="alert alert-ok">{sp.msg}</div>}
      {sp.error && <div className="alert alert-error" role="alert">{sp.error}</div>}
      {sub.status === "suspended" && <div className="alert alert-error">{C.suspended(sub.suspendedReason ?? "")}<Link href={`/contact?app=${sub.app.slug}`}>{C.askSupport}</Link></div>}

      <div className="panel">
        <dl className="dl">
          <dt>{C.status}</dt><dd><StatusBadge status={sub.status} /></dd>
          <dt>{C.space}</dt><dd>{sub.tenantName}</dd>
          <dt>{C.plan}</dt><dd>{sub.planNameSnapshot}</dd>
          <dt>{C.priceAtApply}</dt><dd>{sub.kind === "trial" ? C.trial : sub.priceJpySnapshot === 0 ? C.free : C.pricePerSpace(yen(sub.priceJpySnapshot))}</dd>
          {sub.startedAt && <><dt>{C.startedAt}</dt><dd>{formatJst(sub.startedAt, true)}</dd></>}
          {sub.trialEndsAt && <><dt>{C.trialEnds}</dt><dd>{formatJst(sub.trialEndsAt, true)}</dd></>}
          {sub.kind === "paid" && sub.currentPeriodEnd && <><dt>{C.currentPeriod}</dt><dd>{formatJst(sub.currentPeriodStart, true)} 〜 {formatJst(sub.currentPeriodEnd, true)}</dd></>}
          {sub.cancelAt && <><dt>{C.cancelAt}</dt><dd>{formatJst(sub.cancelAt, true)}{C.usableUntil}</dd></>}
          {sub.kind === "paid" && <><dt>{C.payment}</dt><dd>{sub.paymentMode === "card" ? `${C.card}${sub.paymentMethod ? `（${sub.paymentMethod.brand} •••• ${sub.paymentMethod.last4}）` : ""}` : sub.paymentMode === "starpay" ? C.starpay : C.invoice}{sub.status !== "pending" && C.autoRenewState(sub.autoRenew)}</dd></>}
          {sub.scheduledPlan && <><dt>{sub.status === "trialing" ? C.switching : C.nextPeriod}</dt><dd>{sub.scheduledPlan.name}（{priceLabel(sub.scheduledPlan)}）</dd></>}
          {sub.request && <><dt>{C.termsAgreed}</dt><dd>{C.termsVersion(sub.request.termsVersion, formatJst(sub.request.agreedAt, true))}</dd></>}
        </dl>
        {ok && <div style={{ marginTop: 16 }}><a className="btn btn-primary" href={`/launch/${sub.id}`}>{C.open}</a></div>}
      </div>

      <h2 style={{ marginTop: 32 }}>{C.manage}</h2>
      <div className="stack">
        {sub.status === "pending" && <Action op="withdraw" label={C.withdraw} confirm={C.withdrawConfirm} variant="btn-danger" />}
        {sub.status === "trialing" && (
          <>
            <div className="panel"><p className="small" style={{ marginTop: 0 }}>{C.trialNote}</p><a className="btn btn-primary btn-sm" href="#change">{C.toPaid}</a></div>
            <Action op="end_trial" label={C.endTrial} confirm={C.endTrialConfirm} variant="btn-danger" />
          </>
        )}
        {sub.status === "active" && sub.kind === "free" && <Action op="cancel" label={C.stopFree} confirm={C.stopFreeConfirm} variant="btn-danger" />}
        {sub.status === "active" && sub.kind === "paid" && <Action op="cancel" label={C.cancelPaid} confirm={C.cancelPaidConfirm(formatJst(sub.currentPeriodEnd, true))} variant="btn-danger" />}
        {sub.status === "cancel_scheduled" && <Action op="undo_cancel" label={C.undoCancel} confirm={C.undoCancelConfirm} />}
        {["expired", "canceled", "rejected", "withdrawn"].includes(sub.status) && <div className="panel"><p className="small" style={{ marginTop: 0 }}>{C.ended}</p><Link className="btn btn-primary btn-sm" href={`/apps/${sub.app.slug}`}>{C.toDetail}</Link></div>}
      </div>


      {(unitPrice > 0 || usage.requests > 0) && (
        <section style={{ marginTop: 32 }}>
          <h2>{C.usageTitle(usageMonth.key)}</h2>
          <div className="panel stack">
            <dl className="dl">
              <dt>{C.requests}</dt><dd>{usage.requests.toLocaleString()}</dd>
              <dt>{C.tokens}</dt><dd>{C.tokensValue(usage.inputTokens.toLocaleString(), usage.outputTokens.toLocaleString())}</dd>
              <dt>{C.unitPrice}</dt><dd>{unitPrice > 0 ? C.perMTok(unitPrice.toLocaleString()) : C.noMetered}</dd>
              <dt>{C.monthCost}</dt><dd><strong>¥{usage.costJpy.toLocaleString()}</strong>{C.monthCostNote}</dd>
              <dt>{C.cap}</dt><dd>{sub.usageCapJpy === null ? C.none : C.capValue(sub.usageCapJpy.toLocaleString())}</dd>
            </dl>
            {s.isOwner && unitPrice > 0 && (
              <form action={usageCapAction} className="row">
                <input type="hidden" name="id" value={sub.id} />
                <label className="small" htmlFor="cap">{C.capLabel}</label>
                <input id="cap" name="cap" type="number" min={0} defaultValue={sub.usageCapJpy ?? ""} style={{ width: 120, height: 34 }} />
                <button className="btn btn-secondary btn-sm">{C.save}</button>
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
            <h2>{C.planChange}</h2>
            {sub.scheduledPlan ? (
              <form action={planChangeAction} className="panel row" style={{ justifyContent: "space-between" }}>
                <input type="hidden" name="id" value={sub.id} /><input type="hidden" name="op" value="cancel_change" />
                <span className="small">{sub.status === "trialing" ? C.switchingTo(sub.scheduledPlan.name) : C.changesAt(formatJst(sub.currentPeriodEnd, true), sub.scheduledPlan.name)}</span>
                <button className="btn btn-ghost btn-sm">{C.cancelChange}</button>
              </form>
            ) : (
              <>
                <p className="small muted">{sub.kind === "paid" ? C.changeNotePaid : sub.status === "trialing" ? C.changeNoteTrial : C.changeNoteFree}</p>
                <div className="plan-grid">
                  {others.map((p) => (
                    <form key={p.id} action={planChangeAction} className="plan-card stack">
                      <input type="hidden" name="id" value={sub.id} /><input type="hidden" name="planVersionId" value={p.id} /><input type="hidden" name="expectedPriceJpy" value={p.priceJpy} />
                      <h3 style={{ margin: 0 }}>{p.name}</h3>
                      <div className="price">{priceLabel(p)}</div>
                      <p className="small muted" style={{ whiteSpace: "pre-line", margin: 0 }}>{p.includes}</p>
                      {sub.status === "trialing" && (
                        <div className="small">
                          <label className="check"><input type="radio" name="payment" value="card" defaultChecked /> {C.cardNow}</label>
                          <label className="check"><input type="radio" name="payment" value="invoice" /> {C.invoice}</label>
                        </div>
                      )}
                      <button className="btn btn-secondary btn-sm">{sub.kind === "paid" ? C.nextPeriodPlan : C.switchPlan}</button>
                    </form>
                  ))}
                </div>
              </>
            )}
          </section>
        );
      })()}

      {s.isOwner && sub.kind === "paid" && sub.paymentMode !== "starpay" && ["active", "cancel_scheduled"].includes(sub.status) && (
        <section style={{ marginTop: 32 }}>
          <h2>{C.autoRenew}</h2>
          <div className="panel stack">
            {sub.autoRenew ? (
              <form action={autoRenewAction} className="row" style={{ justifyContent: "space-between" }}>
                <input type="hidden" name="id" value={sub.id} /><input type="hidden" name="on" value="0" />
                <span className="small">{C.autoRenewOn(sub.paymentMethod ? `${sub.paymentMethod.brand} •••• ${sub.paymentMethod.last4}` : C.savedCard)}</span>
                <button className="btn btn-ghost btn-sm">{C.stopAutoRenew}</button>
              </form>
            ) : cards.length ? (
              <form action={autoRenewAction} className="row">
                <input type="hidden" name="id" value={sub.id} /><input type="hidden" name="on" value="1" />
                <select name="paymentMethodId" aria-label={C.cardLabel} style={{ height: 34 }}>{cards.map((c) => <option key={c.id} value={c.id}>{c.brand} •••• {c.last4}</option>)}</select>
                <button className="btn btn-secondary btn-sm">{C.useCard}</button>
              </form>
            ) : <p className="small" style={{ margin: 0 }}>{C.needCard}<Link href="/my/billing">{C.registerCard}</Link></p>}
            {sub.autoRenew && cards.length > 1 && (
              <form action={autoRenewAction} className="row">
                <input type="hidden" name="id" value={sub.id} /><input type="hidden" name="on" value="1" />
                <select name="paymentMethodId" aria-label={C.cardLabel} defaultValue={sub.paymentMethodId ?? ""} style={{ height: 34 }}>{cards.map((c) => <option key={c.id} value={c.id}>{c.brand} •••• {c.last4}</option>)}</select>
                <button className="btn btn-ghost btn-sm">{C.changeCard}</button>
              </form>
            )}
          </div>
        </section>
      )}

      {sub.periods.length > 0 && (
        <>
          <h2 style={{ marginTop: 32 }}>{C.history}</h2>
          <div className="table-wrap"><table className="table"><thead><tr><th>{C.kind}</th><th>{C.start}</th><th>{C.end}</th></tr></thead><tbody>
            {sub.periods.map((p) => <tr key={p.id}><td>{p.kind === "paid" ? C.kindPaid : p.kind === "trial" ? C.kindTrial : C.kindFree}</td><td>{formatJst(p.startsAt, true)}</td><td>{formatJst(p.endsAt, true)}</td></tr>)}
          </tbody></table></div>
        </>
      )}
    </div>
  );
}
