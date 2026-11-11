"use client";
import { useActionState } from "react";
import { addCardAction, type FormState } from "@/app/actions";

export function AddCardForm({ children }: { children: React.ReactNode }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addCardAction, undefined);
  return (
    <form action={action} className="stack">
      {children}
      {state?.error && <div className="alert alert-error" role="alert">{state.error}</div>}
      {state?.ok && <div className="alert alert-ok" role="status">{state.ok}</div>}
      <div><button className="btn btn-secondary btn-sm" disabled={pending}>{pending ? "登録中…" : "カードを登録"}</button></div>
    </form>
  );
}
