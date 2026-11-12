import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { formatJst } from "@/lib/time";
import { yen } from "@/lib/text";
import { removeCardAction, starpayLinkAction } from "@/app/actions";
import { getLink } from "@/lib/starpay";
import { AddCardForm } from "@/components/AddCardForm";
import { CardFields } from "@/components/CardFields";
import { Flash } from "@/components/Flash";
import { getMessages } from "@/lib/messages";

export async function generateMetadata() {
  return { title: (await getMessages()).ui.billing.title };
}

export default async function Billing({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const sp = await searchParams;
  const t = await getMessages();
  const B = t.ui.billing;
  const s = await getSession();
  if (!s) redirect("/auth/login?returnTo=/my/billing");
  if (!s.isOwner) {
    return <div className="container" style={{ padding: "32px 16px" }}><h1>{B.title}</h1><div className="alert alert-warn">{B.ownerOnly}</div></div>;
  }
  const rows = await prisma.billingRecord.findMany({ where: { tenantId: s.tenantId! }, include: { subscription: { include: { app: { select: { name: true } } } } }, orderBy: { createdAt: "desc" } });
  const pending = await prisma.subscription.findMany({ where: { tenantId: s.tenantId!, status: "pending", paymentMode: "invoice" }, include: { app: { select: { name: true } } } });
  const cards = await prisma.paymentMethod.findMany({ where: { tenantId: s.tenantId!, active: true }, include: { subscriptions: { where: { autoRenew: true, liveKey: { not: null } }, include: { app: { select: { name: true } } } } }, orderBy: { createdAt: "desc" } });
  const starpay = await getLink(s.tenantId);
  const failed = await prisma.paymentIntent.findMany({ where: { tenantId: s.tenantId!, status: "failed" }, include: { subscription: { include: { app: { select: { name: true } } } } }, orderBy: { updatedAt: "desc" }, take: 5 });
  return (
    <div className="container" style={{ paddingBottom: 64 }}>
      <div className="breadcrumb"><Link href="/my/apps">{t.ui.myApps.title}</Link> ／ {B.title}</div>
      <h1 style={{ marginTop: 12 }}>{B.title}</h1>
      <p className="muted small"><strong>{B.spaceNote(s.tenantName ?? "")}</strong>　{B.taxNote}</p>
      <Flash msg={sp.msg} error={sp.error} />
      <h2 style={{ marginTop: 24 }}>{B.methods}</h2>
      <div className="panel stack" style={{ marginBottom: 32 }}>
        {cards.length === 0 && <p className="small muted" style={{ margin: 0 }}>{B.noCards}</p>}
        {cards.map((c) => (
          <form key={c.id} action={removeCardAction} className="row" style={{ justifyContent: "space-between" }}>
            <input type="hidden" name="id" value={c.id} />
            <span><strong>{c.brand} •••• {c.last4}</strong> <span className="small muted">{B.expires(`${String(c.expMonth).padStart(2, "0")}/${String(c.expYear).slice(-2)}`)}{c.subscriptions.length ? B.autoRenewFor(c.subscriptions.map((x) => x.app.name).join(B.sep)) : ""}</span></span>
            <button className="btn btn-ghost btn-sm">{B.remove}</button>
          </form>
        ))}
        <details><summary style={{ cursor: "pointer", fontWeight: 600 }}>{B.addCard}</summary><div style={{ marginTop: 8 }}><AddCardForm labels={{ register: t.ui.card.register, registering: t.ui.card.registering }}><CardFields /></AddCardForm></div></details>
      </div>
      <h2>{B.starpay.title}</h2>
      <div className="panel stack" style={{ marginBottom: 32 }}>
        <p className="small muted" style={{ margin: 0 }}>{B.starpay.intro}</p>
        {starpay ? (
          <form action={starpayLinkAction} className="row" style={{ justifyContent: "space-between" }}>
            <input type="hidden" name="op" value="unlink" />
            <strong>{B.starpay.linked(starpay.merchantId, starpay.merchantName)}</strong>
            <button className="btn btn-ghost btn-sm">{B.starpay.unlink}</button>
          </form>
        ) : (
          <form action={starpayLinkAction} className="row" style={{ alignItems: "flex-end" }}>
            <div className="form-row" style={{ margin: 0 }}><label htmlFor="merchantId">{B.starpay.merchant}</label><input id="merchantId" name="merchantId" type="text" required placeholder={B.starpay.placeholder} style={{ width: 220 }} /></div>
            <button className="btn btn-secondary btn-sm">{B.starpay.link}</button>
          </form>
        )}
      </div>
      {failed.length > 0 && <div className="alert alert-error">{B.failed(failed.map((f) => `${f.subscription.app.name}（${yen(f.amountJpy)}・${f.failureReason ?? ""}）`).join(B.sep))}</div>}
      <h2>{B.history}</h2>
      {pending.length > 0 && <div className="alert alert-info">{B.pending(pending.map((p) => `${p.app.name}（${yen(p.priceJpySnapshot)}）`).join(B.sep))}</div>}
      {rows.length === 0 ? <div className="empty">{B.empty}</div> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{B.cols.app}</th><th>{B.cols.period}</th><th>{B.cols.amount}</th><th>{B.cols.status}</th><th>{B.cols.paidAt}</th><th>{B.cols.method}</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td>{r.subscription.app.name}{r.kind === "usage" && <span className="tag" style={{ marginLeft: 6 }}>{B.usageTag}</span>}</td><td>{formatJst(r.periodStart)} 〜 {formatJst(r.periodEnd)}</td><td>{yen(r.amountJpy)}</td><td>{r.channel === "starpay" && r.status === "due" ? B.starpay.due : B.statuses[r.status] ?? r.status}</td><td>{formatJst(r.paidAt)}</td><td>{r.channel === "starpay" ? B.starpay.channel : r.receiptRef?.startsWith("ch_") ? B.card : B.invoice}</td></tr>)}</tbody>
        </table></div>
      )}
    </div>
  );
}
