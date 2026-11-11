"use client";
import { useActionState } from "react";
import { reviewAction, type FormState } from "@/app/actions";

export function ReviewForm({ appId, slug, initial }: { appId: string; slug: string; initial?: { rating: number; title: string; body: string } }) {
  const [state, action, pending] = useActionState<FormState, FormData>(reviewAction, undefined);
  if (state?.ok) return <div className="alert alert-ok" role="status">{state.ok}</div>;
  return (
    <form action={action} className="panel stack">
      <input type="hidden" name="appId" value={appId} />
      <input type="hidden" name="slug" value={slug} />
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 600, fontSize: 14 }}>評価</legend>
        <div className="row">{[5, 4, 3, 2, 1].map((n) => <label key={n} className="check"><input type="radio" name="rating" value={n} defaultChecked={(initial?.rating ?? 5) === n} required /> {"★".repeat(n)}<span className="sr-only">{n}点</span></label>)}</div>
      </fieldset>
      <div className="form-row" style={{ margin: 0 }}><label htmlFor="rv-title">タイトル</label><input id="rv-title" name="title" type="text" maxLength={80} required defaultValue={initial?.title} /></div>
      <div className="form-row" style={{ margin: 0 }}><label htmlFor="rv-body">本文（10文字以上）</label><textarea id="rv-body" name="body" maxLength={2000} required defaultValue={initial?.body} /></div>
      {state?.error && <div className="alert alert-error" role="alert">{state.error}</div>}
      <div><button className="btn btn-primary btn-sm" disabled={pending}>{pending ? "送信中…" : initial ? "レビューを更新" : "レビューを投稿"}</button></div>
    </form>
  );
}
