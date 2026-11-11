"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { inquiryAction, type FormState } from "@/app/actions";
import type { Messages } from "@/lib/messages";

function Submit({ label, sending }: { label: string; sending: string }) {
  const { pending } = useFormStatus();
  return <button className="btn btn-primary" disabled={pending}>{pending ? sending : label}</button>;
}

export function ContactForm({ labels: L, apps, defaults }: { labels: Messages["ui"]["contact"]["form"]; apps: { slug: string; name: string }[]; defaults: { app?: string; type?: string; name?: string; email?: string } }) {
  const [state, action] = useActionState<FormState, FormData>(inquiryAction, undefined);
  if (state?.ok) return <div className="alert alert-ok" role="status">{L.receivedPre}<strong>{state.ok}</strong><br />{L.receivedPost}</div>;
  return (
    <form action={action} className="panel">
      <div className="form-row"><label htmlFor="type">{L.type}</label>
        <select id="type" name="type" defaultValue={defaults.type ?? "usage"}>
          {(Object.keys(L.types) as (keyof typeof L.types)[]).map((k) => <option key={k} value={k}>{L.types[k]}</option>)}
        </select></div>
      <div className="form-row"><label htmlFor="app">{L.app}</label>
        <select id="app" name="app" defaultValue={defaults.app ?? ""}><option value="">{L.noApp}</option>{apps.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}</select></div>
      <div className="grid-2">
        <div className="form-row"><label htmlFor="name">{L.name}</label><input id="name" name="name" type="text" required defaultValue={defaults.name} /></div>
        <div className="form-row"><label htmlFor="email">{L.email}</label><input id="email" name="email" type="email" required defaultValue={defaults.email} /></div>
      </div>
      <div className="form-row"><label htmlFor="company">{L.company}</label><input id="company" name="company" type="text" /></div>
      <div className="form-row"><label htmlFor="message">{L.message}</label><textarea id="message" name="message" required maxLength={4000} /></div>
      {state?.error && <div className="alert alert-error" role="alert">{state.error}</div>}
      <Submit label={L.submit} sending={L.sending} />
    </form>
  );
}
