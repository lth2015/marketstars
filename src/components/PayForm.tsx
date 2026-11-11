"use client";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { payAction, type FormState } from "@/app/actions";

function Submit({ label, processing }: { label: string; processing: string }) {
  const { pending } = useFormStatus();
  return <button className="btn btn-primary btn-block" disabled={pending} aria-busy={pending}>{pending ? processing : label}</button>;
}

export function PayForm({ intentId, cards, label, labels: L, children }: { intentId: string; cards: { id: string; label: string }[]; label: string; labels: { card: string; newCard: string; autoRenew: string; processing: string }; children: React.ReactNode }) {
  const [state, action] = useActionState<FormState, FormData>(payAction, undefined);
  const [sel, setSel] = useState(cards[0]?.id ?? "new");
  return (
    <form action={action} className="stack">
      <input type="hidden" name="intentId" value={intentId} />
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>{L.card}</legend>
        {cards.map((c) => <label key={c.id} className="check" style={{ marginBottom: 6 }}><input type="radio" name="paymentMethodId" value={c.id} checked={sel === c.id} onChange={() => setSel(c.id)} /> {c.label}</label>)}
        <label className="check"><input type="radio" name="paymentMethodId" value="new" checked={sel === "new"} onChange={() => setSel("new")} /> {L.newCard}</label>
      </fieldset>
      {sel === "new" && children}
      <label className="check"><input type="checkbox" name="autoRenew" defaultChecked /> <span>{L.autoRenew}</span></label>
      {state?.error && <div className="alert alert-error" role="alert">{state.error}</div>}
      <Submit label={label} processing={L.processing} />
    </form>
  );
}
