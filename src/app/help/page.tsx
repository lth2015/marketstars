import Link from "next/link";
import { prisma } from "@/lib/db";

export const metadata = { title: "ヘルプ" };

export default async function Help() {
  const items = await prisma.contentEntry.findMany({ where: { kind: "help", published: true }, orderBy: { sortOrder: "asc" } });
  return (
    <div className="container" style={{ maxWidth: 960, paddingBottom: 64 }}>
      <div className="breadcrumb"><Link href="/">ホーム</Link> ／ ヘルプ</div>
      <h1 style={{ marginTop: 12 }}>ヘルプ</h1>
      <div className="card-grid cols-auto">
        {items.map((h) => <Link key={h.id} href={`/help/${h.slug}`} className="panel" style={{ textDecoration: "none", color: "var(--text)" }}><h2 style={{ fontSize: 18, margin: "0 0 8px" }}>{h.title}</h2><p className="small muted" style={{ margin: 0 }}>{h.body.slice(0, 70)}…</p></Link>)}
      </div>
      <div className="panel" style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 18, margin: "0 0 8px" }}>解決しない場合</h2>
        <p className="small muted">契約・請求は MarketStars 運営、アプリの使い方は各アプリの提供会社が対応します。</p>
        <Link className="btn btn-secondary btn-sm" href="/contact">お問い合わせ</Link>
      </div>
    </div>
  );
}
