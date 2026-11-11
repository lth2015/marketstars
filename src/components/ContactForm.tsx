"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { inquiryAction, type FormState } from "@/app/actions";

function Submit() {
  const { pending } = useFormStatus();
  return <button className="btn btn-primary" disabled={pending}>{pending ? "送信中…" : "送信する"}</button>;
}

export function ContactForm({ apps, defaults }: { apps: { slug: string; name: string }[]; defaults: { app?: string; type?: string; name?: string; email?: string } }) {
  const [state, action] = useActionState<FormState, FormData>(inquiryAction, undefined);
  if (state?.ok) return <div className="alert alert-ok" role="status">お問い合わせを受け付けました。受付番号：<strong>{state.ok}</strong><br />担当者より順次ご連絡します。</div>;
  return (
    <form action={action} className="panel">
      <div className="form-row"><label htmlFor="type">お問い合わせの種類</label>
        <select id="type" name="type" defaultValue={defaults.type ?? "usage"}>
          <option value="usage">アプリの使い方</option><option value="contract">契約・お申し込み</option><option value="billing">請求・お支払い</option>
          <option value="provider">アプリ掲載のご相談</option><option value="account_deletion">アカウント削除の申請</option><option value="other">その他</option>
        </select></div>
      <div className="form-row"><label htmlFor="app">関連するアプリ（任意）</label>
        <select id="app" name="app" defaultValue={defaults.app ?? ""}><option value="">選択しない</option>{apps.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}</select></div>
      <div className="grid-2">
        <div className="form-row"><label htmlFor="name">お名前（必須）</label><input id="name" name="name" type="text" required defaultValue={defaults.name} /></div>
        <div className="form-row"><label htmlFor="email">メールアドレス（必須）</label><input id="email" name="email" type="email" required defaultValue={defaults.email} /></div>
      </div>
      <div className="form-row"><label htmlFor="company">会社・店舗名（任意）</label><input id="company" name="company" type="text" /></div>
      <div className="form-row"><label htmlFor="message">お問い合わせ内容（必須）</label><textarea id="message" name="message" required maxLength={4000} /></div>
      {state?.error && <div className="alert alert-error" role="alert">{state.error}</div>}
      <Submit />
    </form>
  );
}
