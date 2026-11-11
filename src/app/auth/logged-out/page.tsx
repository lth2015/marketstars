import { config } from "@/lib/config";

export const metadata = { title: "ログアウト" };

/** 全设备退出的中间页：本地会话已删除，自动前往共通 SSO 的确认页（链接为后备）。 */
export default async function LoggedOut({ searchParams }: { searchParams: Promise<{ global?: string }> }) {
  const global = (await searchParams).global === "1" && !!config.sso.logoutUrl;
  return (
    <div className="container" style={{ maxWidth: 640, padding: "48px 16px" }}>
      {global && <meta httpEquiv="refresh" content={`0;url=${config.sso.logoutUrl}`} />}
      <h1>MarketStars からログアウトしました</h1>
      {global ? (
        <div className="panel stack">
          <p style={{ margin: 0 }}>続けて、共通アカウントのすべての端末からのログアウトを確認します。自動で移動しない場合は次のボタンを押してください。</p>
          <a className="btn btn-primary" href={config.sso.logoutUrl}>すべての端末からログアウトを続ける</a>
        </div>
      ) : <a className="btn btn-secondary" href="/">トップへ戻る</a>}
    </div>
  );
}
