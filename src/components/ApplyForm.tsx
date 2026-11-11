"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { applyAction, type FormState } from "@/app/actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <button className="btn btn-primary btn-block" type="submit" disabled={pending} aria-busy={pending}>{pending ? "送信中…" : label}</button>;
}

export function ApplyForm(props: { appId: string; planVersionId: string; expectedPriceJpy: number; mode: "trial" | "start"; idempotencyKey: string; label: string; paid: boolean; slug: string }) {
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
          <legend style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>お支払い方法</legend>
          <label className="check" style={{ marginBottom: 6 }}><input type="radio" name="payment" value="card" defaultChecked /> <span>クレジットカード（すぐに利用開始・毎月自動更新）</span></label>
          <label className="check"><input type="radio" name="payment" value="invoice" /> <span>請求書払い（運営の入金確認後に利用開始）</span></label>
        </fieldset>
      )}
      {props.paid && (
        <div className="form-row">
          <label htmlFor="contactNote">請求書の宛名・ご連絡事項（任意）</label>
          <textarea id="contactNote" name="contactNote" maxLength={2000} placeholder="例：株式会社〇〇 経理部 宛" />
        </div>
      )}
      <label className="check"><input type="checkbox" name="agreePlatform" required /> <span><a href="/help/terms" target="_blank">MarketStars 利用規約</a>に同意します</span></label>
      <label className="check"><input type="checkbox" name="agreeProvider" required /> <span>提供会社の利用規約・プライバシーポリシーに同意します</span></label>
      {state?.error && (
        <div className="alert alert-error" role="alert">
          {state.error}
          {state.code === "price_changed" && <div style={{ marginTop: 8 }}><a href={`/apps/${props.slug}/apply`}>最新の料金で確認し直す</a></div>}
          {state.code === "exists" && <div style={{ marginTop: 8 }}><a href="/my/apps">マイアプリを確認する</a></div>}
        </div>
      )}
      <Submit label={props.label} />
    </form>
  );
}
