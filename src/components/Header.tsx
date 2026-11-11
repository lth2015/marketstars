import Link from "next/link";
import { getSession, isOperator } from "@/lib/session";
import { getLocale, messages } from "@/lib/messages";
import { headers } from "next/headers";
import { NavToggle } from "./NavToggle";
import { unreadCount } from "@/lib/notifications";

export async function Header() {
  const s = await getSession();
  const op = await isOperator(s);
  const unread = await unreadCount(s);
  const t = messages[await getLocale()];
  return (
    <header className="site-header">
      <div className="container bar">
        <Link href="/" className="logo">Market<span>Stars</span></Link>
        <nav className="main-nav" id="main-nav" aria-label={t.nav.main}>
          <Link href="/">{t.nav.home}</Link>
          <Link href="/apps">{t.nav.apps}</Link>
          <Link href="/apps?trial=true">{t.nav.trial}</Link>
          <Link href="/ranking">{t.nav.ranking}</Link>
          <Link href="/my/apps">{t.nav.myApps}</Link>
          <Link href="/help">{t.nav.help}</Link>
          {op && <Link href="/admin">{t.nav.admin}</Link>}
        </nav>
        <form action="/apps" className="header-search" role="search">
          <input name="q" placeholder={t.searchShort} aria-label={t.searchShort} />
          <button type="submit">{t.search}</button>
        </form>
        <div className="user-menu">
          {s ? (
            <>
              <Link href="/my/notifications" className="bell" aria-label={`${t.notifications}${unread ? `（${t.unread(unread)}）` : ""}`}>
                <span aria-hidden>🔔</span>{unread > 0 && <span className="bell-count">{unread > 99 ? "99+" : unread}</span>}
              </Link>
              <Link className="space-chip" href="/account" title={t.space}>{t.space}：{s.tenantName ?? t.noSpace}</Link>
            </>
          ) : (
            <>
              <Link href="/auth/login" className="btn btn-secondary btn-sm">{t.login}</Link>
              <Link href="/auth/login?signup=1" className="btn btn-primary btn-sm hide-sm">{t.signup}</Link>
            </>
          )}
          <NavToggle label={t.nav.menu} />
        </div>
      </div>
    </header>
  );
}

export async function Footer() {
  const locale = await getLocale();
  const t = messages[locale];
  const other = locale === "ja" ? { set: "en", label: "English" } : { set: "ja", label: "日本語" };
  const here = (await headers()).get("x-pathname") ?? "/";
  return (
    <footer className="site-footer">
      <div className="container">
        <nav aria-label="footer">
          <Link href="/help">{t.footer.help}</Link>
          <Link href="/contact">{t.footer.contact}</Link>
          <Link href="/help/terms">{t.footer.terms}</Link>
          <Link href="/help/privacy">{t.footer.privacy}</Link>
          <Link href="/developer">{t.footer.developers}</Link>
          <a href="/api/openapi">{t.footer.api}</a>
          <a href={`/locale?set=${other.set}&returnTo=${encodeURIComponent(here)}`} lang={other.set} hrefLang={other.set}>{t.footer.language}: {other.label}</a>
        </nav>
        <div>© MarketStars</div>
      </div>
    </footer>
  );
}
