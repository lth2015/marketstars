import Link from "next/link";
import { config } from "@/lib/config";
import { DEMO_PERSONAS } from "@/lib/demo-identities";
import { safeReturnTo } from "@/lib/text";

export const metadata = { title: "ログイン" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string; signup?: string; error?: string; switch?: string }> }) {
  const sp = await searchParams;
  const returnTo = safeReturnTo(sp.returnTo);
  const err = sp.error && (
    <div className="alert alert-error" role="alert">
      {sp.error === "sso_unavailable" ? "認証サービスに接続できませんでした。しばらくしてから再度お試しください。アプリの閲覧は引き続き可能です。" : "ログインを完了できませんでした。もう一度お試しください。"}
    </div>
  );

  if (config.authMode === "oidc") {
    return (
      <div className="container" style={{ maxWidth: 560, padding: "48px 16px" }}>
        <h1>{sp.signup ? "新規登録" : "ログイン"}</h1>
        {err}
        <div className="panel stack">
          <p style={{ margin: 0 }}>MarketStars は共通アカウント（SSO）でログインします。パスワードと二段階認証は共通アカウントの画面で入力します。</p>
          <a className="btn btn-primary btn-block" href={`/auth/start?returnTo=${encodeURIComponent(returnTo)}`}>共通アカウントでログイン</a>
          {config.sso.accountUrl && (
            <>
              <a className="btn btn-secondary btn-block" href={config.sso.accountUrl}>共通アカウントを新規登録</a>
              <p className="small muted" style={{ margin: 0 }}>登録とメール確認が終わったら、このページに戻って「ログイン」を押してください。選んでいたアプリのページに戻ります。</p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: 760, padding: "48px 16px" }}>
      <h1>ログイン（デモ）</h1>
      {err}
      <div className="alert alert-warn">デモ環境では共通 SSO の代わりに合成のデモ利用者でログインします。本番環境（AUTH_MODE=oidc）ではこの画面は表示されません。</div>
      <div className="stack">
        {DEMO_PERSONAS.map((p) => (
          <form key={p.userId} method="post" action="/auth/demo" className="panel">
            <input type="hidden" name="userId" value={p.userId} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <h2 style={{ fontSize: 18, marginBottom: 0 }}>{p.name}</h2>
            <p className="small muted" style={{ marginTop: 0 }}>{p.description}</p>
            <div className="form-row">
              <label htmlFor={`t-${p.userId}`}>利用する空間</label>
              <select id={`t-${p.userId}`} name="tenantId">{p.tenants.map((t) => <option key={t.id} value={t.id}>{t.name}{t.owner ? "（オーナー）" : "（メンバー）"}</option>)}</select>
            </div>
            <button className="btn btn-primary" type="submit">この利用者でログイン</button>
          </form>
        ))}
      </div>
      <p className="small muted" style={{ marginTop: 24 }}><Link href="/">トップへ戻る</Link></p>
    </div>
  );
}
