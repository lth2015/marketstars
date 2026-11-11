import Link from "next/link";
import { prisma } from "@/lib/db";
import { getMessages } from "@/lib/messages";

export async function generateMetadata() {
  return { title: (await getMessages()).ui.help.title };
}

export default async function Help() {
  const t = await getMessages();
  const H = t.ui.help;
  const items = await prisma.contentEntry.findMany({ where: { kind: "help", published: true }, orderBy: { sortOrder: "asc" } });
  return (
    <div className="container" style={{ maxWidth: 960, paddingBottom: 64 }}>
      <div className="breadcrumb"><Link href="/">{t.nav.home}</Link> ／ {H.title}</div>
      <h1 style={{ marginTop: 12 }}>{H.title}</h1>
      <div className="card-grid cols-auto">
        {items.map((h) => <Link key={h.id} href={`/help/${h.slug}`} className="panel" style={{ textDecoration: "none", color: "var(--text)" }}><h2 style={{ fontSize: 18, margin: "0 0 8px" }}>{h.title}</h2><p className="small muted" style={{ margin: 0 }}>{h.body.slice(0, 70)}…</p></Link>)}
      </div>
      <div className="panel" style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 18, margin: "0 0 8px" }}>{H.notSolved}</h2>
        <p className="small muted">{H.notSolvedBody}</p>
        <Link className="btn btn-secondary btn-sm" href="/contact">{H.contact}</Link>
      </div>
    </div>
  );
}
