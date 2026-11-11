"use client";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { payAction, type FormState } from "@/app/actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <button className="btn btn-primary btn-block" disabled={pending} aria-busy={pending}>{pending ? "決済処理中…" : label}</button>;
}

export function PayForm({ intentId, cards, label, children }: { intentId: string; cards: { id: string; label: string }[]; label: string; children: React.ReactNode }) {
  const [state, action] = useActionState<FormState, FormData>(payAction, undefined);
  const [sel, setSel] = useState(cards[0]?.id ?? "new");
  return (
    <form action={action} className="stack">
      <input type="hidden" name="intentId" value={intentId} />
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>お支払いに使うカード</legend>
        {cards.map((c) => <label key={c.id} className="check" style={{ marginBottom: 6 }}><input type="radio" name="paymentMethodId" value={c.id} checked={sel === c.id} onChange={() => setSel(c.id)} /> {c.label}</label>)}
        <label className="check"><input type="radio" name="paymentMethodId" value="new" checked={sel === "new"} onChange={() => setSel("new")} /> 新しいカードを使う</label>
      </fieldset>
      {sel === "new" && children}
      <label className="check"><input type="checkbox" name="autoRenew" defaultChecked /> <span>毎月自動で更新する（期間終了の前日にこのカードへ請求。いつでも停止できます）</span></label>
      {state?.error && <div className="alert alert-error" role="alert">{state.error}</div>}
      <Submit label={label} />
    </form>
  );
}
