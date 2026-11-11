import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { visibleWhere } from "@/lib/notifications";
import { formatJst } from "@/lib/time";
import { markNotificationsReadAction } from "@/app/actions";

export const metadata = { title: "お知らせ" };

export default async function Notifications() {
  const s = await getSession();
  if (!s) redirect("/auth/login?returnTo=/my/notifications");
  const rows = await prisma.notification.findMany({ where: visibleWhere(s), include: { reads: { where: { userId: s.userId } } }, orderBy: { createdAt: "desc" }, take: 100 });
  const unread = rows.filter((r) => r.reads.length === 0).length;
  return (
    <div className="container" style={{ maxWidth: 860, paddingBottom: 64 }}>
      <div className="breadcrumb"><Link href="/my/apps">マイアプリ</Link> ／ お知らせ</div>
      <div className="section-head" style={{ marginTop: 12 }}>
        <div><h1 style={{ marginBottom: 4 }}>お知らせ</h1><div className="small muted">空間：{s.tenantName} ・ 未読 {unread} 件</div></div>
        {unread > 0 && <form action={markNotificationsReadAction}><button className="btn btn-secondary btn-sm">すべて既読にする</button></form>}
      </div>
      {rows.length === 0 ? <div className="empty">お知らせはありません。</div> : (
        <div className="stack">
          {rows.map((n) => {
            const inner = (<><div className="small muted">{formatJst(n.createdAt, true)}{n.reads.length === 0 && <span className="tag tag-new" style={{ marginLeft: 8 }}>未読</span>}</div><strong>{n.title}</strong>{n.body && <p className="small" style={{ margin: "4px 0 0" }}>{n.body}</p>}</>);
            return n.link ? <Link key={n.id} href={n.link} className={`panel notice ${n.reads.length ? "" : "unread"}`}>{inner}</Link> : <div key={n.id} className={`panel notice ${n.reads.length ? "" : "unread"}`}>{inner}</div>;
          })}
        </div>
      )}
    </div>
  );
}
