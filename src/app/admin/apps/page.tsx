import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatJst } from "@/lib/time";

export default async function AdminApps() {
  const apps = await prisma.app.findMany({ include: { provider: true, _count: { select: { subscriptions: true } } }, orderBy: [{ status: "asc" }, { updatedAt: "desc" }] });
  return (
    <div className="stack">
      <div className="section-head"><h1 style={{ margin: 0 }}>アプリ管理</h1><Link className="btn btn-primary btn-sm" href="/admin/apps/new">新規作成</Link></div>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>アプリ</th><th>状態</th><th>受付</th><th>おすすめ</th><th>初回公開</th><th>契約数</th></tr></thead>
        <tbody>{apps.map((a) => (
          <tr key={a.id}>
            <td><Link href={`/admin/apps/${a.id}`}>{a.name}</Link><div className="small muted">{a.slug} ・ {a.provider.name}</div></td>
            <td>{a.status}{a.draft ? "（下書きあり）" : ""}{a.suspendedReason ? " ・ 一時停止" : ""}{a.internalTest ? " ・ 社内テスト" : ""}</td>
            <td>{a.acceptingNew ? "受付中" : "停止"}</td><td>{a.recommendWeight}</td><td>{formatJst(a.firstPublishedAt)}</td><td>{a._count.subscriptions}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}
