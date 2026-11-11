import Link from "next/link";
import { getSession, isOperator } from "@/lib/session";
import { t } from "@/lib/messages";
import { NavToggle } from "./NavToggle";
import { unreadCount } from "@/lib/notifications";

export async function Header() {
  const s = await getSession();
  const op = await isOperator(s);
  const unread = await unreadCount(s);
  return (
    <header className="site-header">
      <div className="container bar">
        <Link href="/" className="logo">Market<span>Stars</span></Link>
        <nav className="main-nav" id="main-nav" aria-label="メインナビゲーション">
          <Link href="/">{t.nav.home}</Link>
          <Link href="/apps">{t.nav.apps}</Link>
          <Link href="/apps?trial=true">{t.nav.trial}</Link>
          <Link href="/ranking">{t.nav.ranking}</Link>
          <Link href="/my/apps">{t.nav.myApps}</Link>
          <Link href="/help">{t.nav.help}</Link>
          {op && <Link href="/admin">運営管理</Link>}
        </nav>
        <form action="/apps" className="header-search" role="search">
          <input name="q" placeholder="アプリを検索" aria-label="アプリを検索" />
          <button type="submit">検索</button>
        </form>
        <div className="user-menu">
          {s ? (
            <>
              <Link href="/my/notifications" className="bell" aria-label={`お知らせ${unread ? `（未読 ${unread} 件）` : ""}`}>
                <span aria-hidden>🔔</span>{unread > 0 && <span className="bell-count">{unread > 99 ? "99+" : unread}</span>}
              </Link>
              <Link className="space-chip" href="/account" title="現在の空間">空間：{s.tenantName ?? "未選択"}</Link>
            </>
          ) : (
            <>
              <Link href="/auth/login" className="btn btn-secondary btn-sm">{t.login}</Link>
              <Link href="/auth/login?signup=1" className="btn btn-primary btn-sm hide-sm">{t.signup}</Link>
            </>
          )}
          <NavToggle />
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container">
        <nav aria-label="フッター">
          <Link href="/help">ヘルプ</Link>
          <Link href="/contact">お問い合わせ</Link>
          <Link href="/help/terms">利用規約</Link>
          <Link href="/help/privacy">プライバシーポリシー</Link>
          <Link href="/developer">開発者の方へ</Link>
          <Link href="/api/openapi">API (OpenAPI)</Link>
        </nav>
        <div>© MarketStars</div>
      </div>
    </footer>
  );
}
