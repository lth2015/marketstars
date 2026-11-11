import Link from "next/link";
import { getSession, isOperator } from "@/lib/session";

export const metadata = { title: "運営管理" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  const op = await isOperator(s);
  if (!op) {
    return (
      <div className="container" style={{ padding: "48px 16px" }}>
        <h1>運営管理</h1>
        <div className="alert alert-error">この画面にアクセスする権限がありません。運営空間でログインし、MarketStars 運営権限が付与されている必要があります（空間のオーナー権限とは別です）。</div>
        {!s && <Link className="btn btn-primary" href="/auth/login?returnTo=/admin">ログイン</Link>}
      </div>
    );
  }
  return (
    <div className="container admin-layout">
      <nav className="admin-nav" aria-label="運営メニュー">
        <strong className="small muted" style={{ padding: "8px 12px" }}>運営管理（{op.role}）</strong>
        <Link href="/admin">ダッシュボード</Link>
        <Link href="/admin/apps">アプリ管理</Link>
        <Link href="/admin/submissions">開発者審査</Link>
        <Link href="/admin/taxonomy">分類・絞り込み</Link>
        <Link href="/admin/requests">申込処理</Link>
        <Link href="/admin/subscriptions">契約管理</Link>
        <Link href="/admin/billing">請求記録</Link>
        <Link href="/admin/reviews">レビュー管理</Link>
        <Link href="/admin/inquiries">お問い合わせ</Link>
        <Link href="/admin/content">コンテンツ</Link>
        <Link href="/admin/audit">監査ログ</Link>
      </nav>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}
