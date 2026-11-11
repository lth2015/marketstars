import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { getRanking } from "@/lib/catalog";
import { formatJst } from "@/lib/time";
import { PriceText } from "@/components/AppCard";
import { getMessages } from "@/lib/messages";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).ui.ranking.title };
}

export default async function RankingPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const { category } = await searchParams;
  const t = await getMessages();
  const R = t.ui.ranking;
  const [cats, r] = await Promise.all([prisma.category.findMany({ orderBy: { sortOrder: "asc" } }), getRanking(category)]);
  return (
    <div className="container" style={{ paddingBottom: 64 }}>
      <div className="breadcrumb"><Link href="/">{t.nav.home}</Link> ／ {t.nav.ranking}</div>
      <h1 style={{ marginTop: 12 }}>{R.title}</h1>
      <p className="muted small">{R.basis}{r.computedAt && ` ${R.lastComputed(formatJst(r.computedAt, true))}`}</p>
      <nav className="chips" aria-label={R.categories}>
        <Link className="chip" href="/ranking" aria-current={!category ? "page" : undefined} style={!category ? { borderColor: "var(--primary)", color: "var(--primary)" } : undefined}>{R.overall}</Link>
        {cats.map((c) => (
          <Link key={c.slug} className="chip" href={`/ranking?category=${c.slug}`} aria-current={category === c.slug ? "page" : undefined} style={category === c.slug ? { borderColor: "var(--primary)", color: "var(--primary)" } : undefined}>{c.name}</Link>
        ))}
      </nav>
      {r.entries.length < 3 && <div className="alert alert-info">{R.aggregating}</div>}
      {r.entries.length === 0 ? (
        <div className="empty">{R.empty}</div>
      ) : (
        r.entries.map((e) => (
          <div className="rank-row" key={e.id}>
            <div className="rank-no">{e.rank}</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="app-icon" src={e.app.iconUrl ?? "/placeholder-icon.svg"} alt="" />
            <div>
              <Link className="stretch" href={`/apps/${e.app.slug}`} style={{ fontWeight: 700, color: "var(--text)", textDecoration: "none" }}>{e.app.name}</Link>
              <div className="small muted">{e.app.provider.name} ・ <PriceText app={e.app} /></div>
            </div>
            <div className="rank-count small muted">{t.ui.home.last30(e.count)}</div>
          </div>
        ))
      )}
    </div>
  );
}
