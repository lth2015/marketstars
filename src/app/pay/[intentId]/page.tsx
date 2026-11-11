import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { yen } from "@/lib/text";
import { addOneMonthJst, formatJst } from "@/lib/time";
import { PayForm } from "@/components/PayForm";
import { CardFields } from "@/components/CardFields";

export const metadata = { title: "お支払い" };
const PURPOSE: Record<string, string> = { activate: "有料プランの利用開始", convert_trial: "無料体験から有料プランへの切り替え", upgrade: "無料プランから有料プランへの変更", renew: "利用期間の更新" };

export default async function PayPage({ params }: { params: Promise<{ intentId: string }> }) {
  const { intentId } = await params;
  const s = await getSession();
  if (!s) redirect(`/auth/login?returnTo=/pay/${intentId}`);
  const intent = await prisma.paymentIntent.findFirst({ where: { id: intentId, tenantId: s.tenantId ?? "__none__" }, include: { plan: true, subscription: { include: { app: true } } } });
  if (!intent) notFound();
  if (intent.status === "succeeded") redirect(`/my/apps/${intent.subscriptionId}?paid=1`);
  const cards = s.isOwner ? await prisma.paymentMethod.findMany({ where: { tenantId: s.tenantId!, active: true }, orderBy: { createdAt: "desc" } }) : [];
  const now = new Date();
  return (
    <div className="container" style={{ maxWidth: 720, paddingBottom: 64 }}>
      <div className="breadcrumb"><Link href={`/my/apps/${intent.subscriptionId}`}>契約内容</Link> ／ お支払い</div>
      <h1 style={{ marginTop: 12 }}>お支払い</h1>
      <div className="alert alert-warn small">デモ決済：実際の請求は発生しません。本番では決済代行会社の画面でカード情報を入力し、MarketStars はカード番号を保持しません。</div>
      {intent.status === "canceled" ? <div className="alert alert-error">このお支払いは取り消されています。<Link href={`/my/apps/${intent.subscriptionId}`}>契約内容に戻る</Link></div> : (
        <div className="panel stack">
          <dl className="dl">
            <dt>内容</dt><dd>{PURPOSE[intent.purpose] ?? intent.purpose}</dd>
            <dt>空間</dt><dd><strong>{s.tenantName}</strong></dd>
            <dt>アプリ / プラン</dt><dd>{intent.subscription.app.name} ／ {intent.plan.name}</dd>
            <dt>お支払い金額</dt><dd><strong style={{ fontSize: 20 }}>{yen(intent.amountJpy)}</strong>（税込・1空間あたり1か月分）</dd>
            <dt>利用期間</dt><dd>決済完了時から1か月（例：{formatJst(now, true)} 〜 {formatJst(addOneMonthJst(now), true)}）</dd>
          </dl>
          {intent.status === "failed" && intent.failureReason && <div className="alert alert-error" style={{ margin: 0 }}>前回のお支払いに失敗しました：{intent.failureReason}</div>}
          {!s.isOwner ? <div className="alert alert-warn">お支払いは空間のオーナーのみ可能です。</div> : (
            <PayForm intentId={intent.id} cards={cards.map((c) => ({ id: c.id, label: `${c.brand} •••• ${c.last4}（${String(c.expMonth).padStart(2, "0")}/${String(c.expYear).slice(-2)}）` }))} label={`${yen(intent.amountJpy)} を支払う`}>
              <CardFields />
            </PayForm>
          )}
        </div>
      )}
    </div>
  );
}
