import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, isOperator } from "@/lib/session";
import { config } from "@/lib/config";

export const metadata = { title: "アカウント" };

export default async function AccountPage() {
  const s = await getSession();
  if (!s) redirect("/auth/login?returnTo=/account");
  const op = await isOperator(s);
  return (
    <div className="container" style={{ maxWidth: 860, padding: "32px 16px 64px" }}>
      <h1>アカウント</h1>
      <div className="panel stack">
        <dl className="dl">
          <dt>利用者</dt><dd>{s.userName}{s.email && <span className="muted">（{s.email}）</span>}</dd>
          <dt>現在の空間</dt><dd><strong>{s.tenantName}</strong>（{s.isOwner ? "オーナー" : "メンバー"}）</dd>
          <dt>ID（サポート用）</dt><dd className="small muted"><code>user {s.userId}</code> ・ <code>space {s.tenantId}</code></dd>
          {op && <><dt>運営権限</dt><dd>{op.role} — <Link href="/admin">運営管理へ</Link></dd></>}
        </dl>
        <div className="row">
          <Link className="btn btn-secondary btn-sm" href="/auth/switch?returnTo=/my/apps">空間を切り替える</Link>
          {config.sso.consoleUrl && <a className="btn btn-ghost btn-sm" href={config.sso.consoleUrl}>組織・メンバーを管理（共通 SSO）</a>}
          {config.sso.accountUrl && <a className="btn btn-ghost btn-sm" href={config.sso.accountUrl}>プロフィール・セキュリティ（共通 SSO）</a>}
        </div>
      </div>

      <h2 style={{ marginTop: 40 }}>ログアウト・解約・アカウント削除</h2>
      <div className="grid-2">
        <div className="panel stack">
          <h3>ログアウト</h3>
          <p className="small muted" style={{ margin: 0 }}>この MarketStars からログアウトします。他のアプリのログインは維持されます。</p>
          <form method="post" action="/auth/logout"><button className="btn btn-secondary btn-sm">ログアウト</button></form>
        </div>
        <div className="panel stack">
          <h3>すべての端末からログアウト</h3>
          <p className="small muted" style={{ margin: 0 }}>共通 SSO の確認画面で、すべてのアプリ・端末からログアウトします。</p>
          <form method="post" action="/auth/logout"><input type="hidden" name="global" value="1" /><button className="btn btn-secondary btn-sm" disabled={!config.sso.logoutUrl}>すべての端末からログアウト</button></form>
          {!config.sso.logoutUrl && <p className="small muted" style={{ margin: 0 }}>デモ環境では利用できません。</p>}
        </div>
        <div className="panel stack">
          <h3>アプリの解約</h3>
          <p className="small muted" style={{ margin: 0 }}>空間で契約中のアプリを終了します。アカウントは削除されません。</p>
          <Link className="btn btn-secondary btn-sm" href="/my/apps">マイアプリで解約する</Link>
        </div>
        <div className="panel stack">
          <h3>アカウント削除</h3>
          <p className="small muted" style={{ margin: 0 }}>共通アカウントは複数のアプリで共有されるため、削除は共通 SSO が一括で処理します。現在はお問い合わせによる受付のみです。最後のオーナーである空間、未払いの請求、利用中の契約がある場合は、先に移管・解約が必要です。</p>
          <Link className="btn btn-danger btn-sm" href="/contact?type=account_deletion">削除を申請する</Link>
        </div>
      </div>
    </div>
  );
}
