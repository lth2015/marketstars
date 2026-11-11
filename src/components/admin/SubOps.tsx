import type { Subscription } from "@prisma/client";
import { subscriptionOpAction } from "@/app/admin/actions";

const inp = { height: 34, border: "1px solid var(--border)", borderRadius: 8, padding: "0 8px", minWidth: 0 } as const;

export function SubOps({ sub, ret, amount }: { sub: Subscription; ret: string; amount?: number }) {
  const H = ({ op }: { op: string }) => (<><input type="hidden" name="id" value={sub.id} /><input type="hidden" name="op" value={op} /><input type="hidden" name="return" value={ret} /></>);
  const converting = sub.status === "trialing" && !!sub.scheduledPlanVersionId;
  const canPay = (sub.kind === "paid" && ["pending", "active", "cancel_scheduled", "suspended"].includes(sub.status)) || converting;
  return (
    <div className="stack" style={{ minWidth: 280 }}>
      {canPay && (
        <form action={subscriptionOpAction} className="row"><H op="confirm" />
          <input name="receiptRef" placeholder="入金証憑番号（必須）" required style={inp} />
          <input name="amountJpy" type="number" placeholder="入金額" required defaultValue={amount ?? sub.priceJpySnapshot} style={{ ...inp, width: 100 }} />
          <button className="btn btn-primary btn-sm">{sub.status === "pending" || converting ? "入金確認して開始" : "入金確認して延長"}</button>
        </form>
      )}
      {sub.status === "pending" && <form action={subscriptionOpAction} className="row"><H op="reject" /><input name="reason" placeholder="お断り理由" style={inp} /><button className="btn btn-danger btn-sm">お断り</button></form>}
      {["trialing", "active", "cancel_scheduled"].includes(sub.status) && <form action={subscriptionOpAction} className="row"><H op="suspend" /><input name="reason" placeholder="停止理由（必須）" required style={inp} /><button className="btn btn-danger btn-sm">一時停止</button></form>}
      {sub.status === "suspended" && <form action={subscriptionOpAction}><H op="resume" /><button className="btn btn-secondary btn-sm">停止解除</button></form>}
      {["active", "trialing"].includes(sub.status) && <form action={subscriptionOpAction} className="row"><H op="cancel" /><input name="reason" placeholder="理由" style={inp} /><button className="btn btn-ghost btn-sm">{sub.kind === "paid" ? "期間末で解約" : "利用停止"}</button></form>}
    </div>
  );
}
