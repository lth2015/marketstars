import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { visibleWhere } from "@/lib/notifications";
import { formatJst } from "@/lib/time";
import { markNotificationsReadAction } from "@/app/actions";
import { getMessages } from "@/lib/messages";

export async function generateMetadata() {
  return { title: (await getMessages()).ui.notices.title };
}

export default async function Notifications() {
  const s = await getSession();
  if (!s) redirect("/auth/login?returnTo=/my/notifications");
  const t = await getMessages();
  const N = t.ui.notices;
  const rows = await prisma.notification.findMany({ where: visibleWhere(s), include: { reads: { where: { userId: s.userId } } }, orderBy: { createdAt: "desc" }, take: 100 });
  const unread = rows.filter((r) => r.reads.length === 0).length;
  return (
    <div className="container" style={{ maxWidth: 860, paddingBottom: 64 }}>
      <div className="breadcrumb"><Link href="/my/apps">{t.ui.myApps.title}</Link> ／ {N.title}</div>
      <div className="section-head" style={{ marginTop: 12 }}>
        <div><h1 style={{ marginBottom: 4 }}>{N.title}</h1><div className="small muted">{N.summary(s.tenantName ?? "", unread)}</div></div>
        {unread > 0 && <form action={markNotificationsReadAction}><button className="btn btn-secondary btn-sm">{N.markAll}</button></form>}
      </div>
      {rows.length === 0 ? <div className="empty">{N.empty}</div> : (
        <div className="stack">
          {rows.map((n) => {
            const inner = (<><div className="small muted">{formatJst(n.createdAt, true)}{n.reads.length === 0 && <span className="tag tag-new" style={{ marginLeft: 8 }}>{N.unread}</span>}</div><strong>{n.title}</strong>{n.body && <p className="small" style={{ margin: "4px 0 0" }}>{n.body}</p>}</>);
            return n.link ? <Link key={n.id} href={n.link} className={`panel notice ${n.reads.length ? "" : "unread"}`}>{inner}</Link> : <div key={n.id} className={`panel notice ${n.reads.length ? "" : "unread"}`}>{inner}</div>;
          })}
        </div>
      )}
    </div>
  );
}
