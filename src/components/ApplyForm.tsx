"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { applyAction, type FormState } from "@/app/actions";
import type { Messages } from "@/lib/messages";

type Labels = Messages["ui"]["apply"]["form"];

function Submit({ label, sending }: { label: string; sending: string }) {
  const { pending } = useFormStatus();
  return <button className="btn btn-primary btn-block" type="submit" disabled={pending} aria-busy={pending}>{pending ? sending : label}</button>;
}

export function ApplyForm(props: { appId: string; planVersionId: string; expectedPriceJpy: number; mode: "trial" | "start"; idempotencyKey: string; label: string; paid: boolean; slug: string; labels: Labels }) {
  const L = props.labels;
  const [state, action] = useActionState<FormState, FormData>(applyAction, undefined);
  return (
    <form action={action} className="stack">
      <input type="hidden" name="appId" value={props.appId} />
      <input type="hidden" name="planVersionId" value={props.planVersionId} />
      <input type="hidden" name="expectedPriceJpy" value={props.expectedPriceJpy} />
      <input type="hidden" name="mode" value={props.mode} />
      <input type="hidden" name="idempotencyKey" value={props.idempotencyKey} />
      {props.paid && (
        <fieldset className="form-row" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>{L.payment}</legend>
          <label className="check" style={{ marginBottom: 6 }}><input type="radio" name="payment" value="card" defaultChecked /> <span>{L.payCard}</span></label>
          <label className="check"><input type="radio" name="payment" value="invoice" /> <span>{L.payInvoice}</span></label>
        </fieldset>
      )}
      {props.paid && (
        <div className="form-row">
          <label htmlFor="contactNote">{L.note}</label>
          <textarea id="contactNote" name="contactNote" maxLength={2000} placeholder={L.notePlaceholder} />
        </div>
      )}
      <label className="check"><input type="checkbox" name="agreePlatform" required /> <span>{L.agreePlatformPre}<a href="/help/terms" target="_blank">{L.agreePlatformLink}</a>{L.agreePlatformPost}</span></label>
      <label className="check"><input type="checkbox" name="agreeProvider" required /> <span>{L.agreeProvider}</span></label>
      {state?.error && (
        <div className="alert alert-error" role="alert">
          {state.error}
          {state.code === "price_changed" && <div style={{ marginTop: 8 }}><a href={`/apps/${props.slug}/apply`}>{L.recheck}</a></div>}
          {state.code === "exists" && <div style={{ marginTop: 8 }}><a href="/my/apps">{L.seeMyApps}</a></div>}
        </div>
      )}
      <Submit label={props.label} sending={L.sending} />
    </form>
  );
}
