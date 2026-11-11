import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { yen } from "@/lib/text";
import { addOneMonthJst, formatJst } from "@/lib/time";
import { PayForm } from "@/components/PayForm";
import { CardFields } from "@/components/CardFields";
import { getMessages } from "@/lib/messages";

export async function generateMetadata() {
  return { title: (await getMessages()).ui.pay.title };
}

export default async function PayPage({ params }: { params: Promise<{ intentId: string }> }) {
  const { intentId } = await params;
  const t = await getMessages();
  const P = t.ui.pay;
  const s = await getSession();
  if (!s) redirect(`/auth/login?returnTo=/pay/${intentId}`);
  const intent = await prisma.paymentIntent.findFirst({ where: { id: intentId, tenantId: s.tenantId ?? "__none__" }, include: { plan: true, subscription: { include: { app: true } } } });
  if (!intent) notFound();
  if (intent.status === "succeeded") redirect(`/my/apps/${intent.subscriptionId}?paid=1`);
  const cards = s.isOwner ? await prisma.paymentMethod.findMany({ where: { tenantId: s.tenantId!, active: true }, orderBy: { createdAt: "desc" } }) : [];
  const now = new Date();
  return (
    <div className="container" style={{ maxWidth: 720, paddingBottom: 64 }}>
      <div className="breadcrumb"><Link href={`/my/apps/${intent.subscriptionId}`}>{t.ui.contract.title}</Link> ／ {P.title}</div>
      <h1 style={{ marginTop: 12 }}>{P.title}</h1>
      <div className="alert alert-warn small">{P.demo}</div>
      {intent.status === "canceled" ? <div className="alert alert-error">{P.canceled}<Link href={`/my/apps/${intent.subscriptionId}`}>{P.back}</Link></div> : (
        <div className="panel stack">
          <dl className="dl">
            <dt>{P.what}</dt><dd>{P.purposes[intent.purpose] ?? intent.purpose}</dd>
            <dt>{P.space}</dt><dd><strong>{s.tenantName}</strong></dd>
            <dt>{P.appPlan}</dt><dd>{intent.subscription.app.name} ／ {intent.plan.name}</dd>
            <dt>{P.amount}</dt><dd><strong style={{ fontSize: 20 }}>{yen(intent.amountJpy)}</strong>{P.amountNote}</dd>
            <dt>{P.period}</dt><dd>{P.periodValue(formatJst(now, true), formatJst(addOneMonthJst(now), true))}</dd>
          </dl>
          {intent.status === "failed" && intent.failureReason && <div className="alert alert-error" style={{ margin: 0 }}>{P.lastFailed(intent.failureReason)}</div>}
          {!s.isOwner ? <div className="alert alert-warn">{P.ownerOnly}</div> : (
            <PayForm intentId={intent.id} cards={cards.map((c) => ({ id: c.id, label: `${c.brand} •••• ${c.last4}（${String(c.expMonth).padStart(2, "0")}/${String(c.expYear).slice(-2)}）` }))} label={P.payAmount(yen(intent.amountJpy))} labels={P.form}>
              <CardFields />
            </PayForm>
          )}
        </div>
      )}
    </div>
  );
}
