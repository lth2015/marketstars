"use client";
import { useActionState, useState } from "react";
import { createMandateAction, type FormState } from "@/app/actions";

export function MandateForm({ apps, scopes }: { apps: { id: string; name: string }[]; scopes: Record<string, string> }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createMandateAction, undefined);
  const [all, setAll] = useState(true);
  if (state?.ok) {
    return (
      <div className="alert alert-ok" role="status">
        <strong>エージェント用キーを発行しました。</strong>このキーは今回だけ表示されます。安全な場所に保管し、エージェントの設定に登録してください。
        <pre style={{ background: "#fff", color: "var(--text)", padding: 12, borderRadius: 8, overflowX: "auto", margin: "8px 0 0" }}><code id="agent-key">{state.ok}</code></pre>
        <a href="/my/agents" className="btn btn-secondary btn-sm" style={{ marginTop: 8 }}>閉じる</a>
      </div>
    );
  }
  return (
    <form action={action} className="panel">
      <div className="grid-2">
        <div className="form-row"><label htmlFor="ag-name">エージェント名</label><input id="ag-name" name="name" type="text" required placeholder="例：店舗運営アシスタント" /></div>
        <div className="form-row"><label htmlFor="ag-days">有効期間（日）</label><input id="ag-days" name="days" type="number" min={1} max={365} defaultValue={30} required /></div>
        <div className="form-row"><label htmlFor="ag-budget">月の予算（円）</label><input id="ag-budget" name="budget" type="number" min={0} defaultValue={5000} required /></div>
        <div className="form-row"><label htmlFor="ag-pertx">1回あたりの上限（円）</label><input id="ag-pertx" name="perTx" type="number" min={0} defaultValue={3000} required /></div>
      </div>
      <fieldset className="form-row" style={{ border: 0, padding: 0 }}>
        <legend style={{ fontWeight: 600, fontSize: 14 }}>権限</legend>
        <div className="row">{Object.entries(scopes).map(([k, v]) => <label key={k} className="check"><input type="checkbox" name="scopes" value={k} defaultChecked /> {v}</label>)}</div>
      </fieldset>
      <fieldset className="form-row" style={{ border: 0, padding: 0 }}>
        <legend style={{ fontWeight: 600, fontSize: 14 }}>購入できるアプリ</legend>
        <label className="check"><input type="checkbox" name="allApps" checked={all} onChange={(e) => setAll(e.target.checked)} /> すべての公開アプリ</label>
        {!all && <div className="row" style={{ marginTop: 8 }}>{apps.map((a) => <label key={a.id} className="check"><input type="checkbox" name="apps" value={a.id} /> {a.name}</label>)}</div>}
      </fieldset>
      <p className="small muted">エージェントは、この空間に登録済みのカードで、予算と上限の範囲内に限りアプリを購入できます。購入はすべて記録され、ここからいつでも取り消せます。エージェントによる購入では自動更新はオフになります。</p>
      {state?.error && <div className="alert alert-error" role="alert">{state.error}</div>}
      <button className="btn btn-primary" disabled={pending}>{pending ? "発行中…" : "キーを発行する"}</button>
    </form>
  );
}
