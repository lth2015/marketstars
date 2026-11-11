import Link from "next/link";
import { prisma } from "@/lib/db";
import { cardInclude, getRanking, publicAppWhere } from "@/lib/catalog";
import { AppCard } from "@/components/AppCard";
import { getMessages } from "@/lib/messages";

export default async function Home() {
  const t = await getMessages();
  const [recommended, latest, categories, ranking, topics, help] = await Promise.all([
    prisma.app.findMany({ where: { ...publicAppWhere, recommendWeight: { gt: 0 } }, include: cardInclude, orderBy: [{ recommendWeight: "desc" }, { firstPublishedAt: "desc" }, { id: "asc" }], take: 6 }),
    prisma.app.findMany({ where: publicAppWhere, include: cardInclude, orderBy: [{ firstPublishedAt: "desc" }, { id: "asc" }], take: 6 }),
    prisma.category.findMany({ orderBy: { sortOrder: "asc" } }),
    getRanking(),
    prisma.contentEntry.findMany({ where: { kind: "topic", published: true }, orderBy: { sortOrder: "asc" } }),
    prisma.contentEntry.findMany({ where: { kind: "help", published: true }, orderBy: { sortOrder: "asc" }, take: 4 }),
  ]);
  const topicApps = topics.length
    ? await prisma.app.findMany({ where: { ...publicAppWhere, slug: { in: topics.flatMap((x) => x.body.split(",")) } }, include: cardInclude })
    : [];

  return (
    <>
      <section className="hero">
        <div className="container">
          <h1>{t.brandTagline}</h1>
          <p>{t.heroLead}</p>
          <form action="/apps" className="big-search" role="search">
            <input name="q" placeholder={t.searchPlaceholder} aria-label={t.searchPlaceholder} />
            <button type="submit">{t.search}</button>
          </form>
        </div>
      </section>

      <div className="container">
        {topics.map((tp) => {
          const items = tp.body.split(",").map((slug) => topicApps.find((a) => a.slug === slug)).filter((a): a is NonNullable<typeof a> => !!a);
          if (!items.length) return null;
          return (
            <section className="section" key={tp.id}>
              <div className="panel" style={{ background: "linear-gradient(120deg,#123A63,#185ABD)", color: "#fff", border: 0 }}>
                <div className="small" style={{ opacity: 0.85 }}>{t.ui.home.topic}</div>
                <h2 style={{ margin: "4px 0" }}>{tp.title}</h2>
                <p style={{ margin: "0 0 16px", opacity: 0.9 }}>{tp.summary}</p>
                <div className="row">
                  {items.map((a) => <Link key={a.slug} href={`/apps/${a.slug}`} className="btn btn-sm" style={{ background: "#fff", color: "#123A63" }}>{a.name}</Link>)}
                </div>
              </div>
            </section>
          );
        })}

        <section className="section" aria-labelledby="cat-h">
          <div className="section-head"><h2 id="cat-h">{t.ui.home.byCategory}</h2></div>
          <div className="cat-grid">
            {categories.map((c) => <Link key={c.slug} href={`/apps?category=${c.slug}`}>{c.name}</Link>)}
          </div>
        </section>

        {recommended.length > 0 && (
          <section className="section" aria-labelledby="rec-h">
            <div className="section-head"><h2 id="rec-h">{t.ui.home.recommended}</h2><Link href="/apps?recommended=true">{t.ui.home.seeAll}</Link></div>
            <div className="card-grid">{recommended.map((a) => <AppCard key={a.id} app={a} />)}</div>
          </section>
        )}

        {latest.length > 0 && (
          <section className="section" aria-labelledby="new-h">
            <div className="section-head"><h2 id="new-h">{t.ui.home.latest}</h2><Link href="/apps?sort=new">{t.ui.home.seeAll}</Link></div>
            <div className="card-grid">{latest.map((a) => <AppCard key={a.id} app={a} />)}</div>
          </section>
        )}

        {ranking.entries.length > 0 && (
          <section className="section" aria-labelledby="rank-h">
            <div className="section-head"><h2 id="rank-h">{t.ui.home.ranking}</h2><Link href="/ranking">{t.ui.home.seeRanking}</Link></div>
            {ranking.entries.slice(0, 5).map((e) => (
              <div className="rank-row" key={e.id}>
                <div className="rank-no">{e.rank}</div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="app-icon" src={e.app.iconUrl ?? "/placeholder-icon.svg"} alt="" />
                <div><Link className="stretch" href={`/apps/${e.app.slug}`} style={{ fontWeight: 700, color: "var(--text)", textDecoration: "none" }}>{e.app.name}</Link><div className="small muted">{e.app.provider.name}</div></div>
                <div className="rank-count small muted">{t.ui.home.last30(e.count)}</div>
              </div>
            ))}
          </section>
        )}

        <section className="section" aria-labelledby="help-h">
          <div className="section-head"><h2 id="help-h">{t.ui.home.firstTime}</h2><Link href="/help">{t.ui.home.seeHelp}</Link></div>
          <div className="card-grid cols-auto">
            {help.map((h) => (
              <Link key={h.id} href={`/help/${h.slug}`} className="panel" style={{ textDecoration: "none", color: "var(--text)" }}>
                <h3>{h.title}</h3>
                <p className="small muted" style={{ margin: 0 }}>{h.body.slice(0, 60)}…</p>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
