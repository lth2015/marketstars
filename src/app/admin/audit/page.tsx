import { prisma } from "@/lib/db";

export default async function Audit({ searchParams }: { searchParams: Promise<{ object?: string }> }) {
  const sp = await searchParams;
  const rows = await prisma.auditEvent.findMany({ where: sp.object ? { objectId: sp.object } : {}, orderBy: { createdAt: "desc" }, take: 200 });
  return (
    <div className="stack">
      <h1>監査ログ</h1>
      <form className="row"><input name="object" defaultValue={sp.object} placeholder="対象 ID で絞り込み" style={{ height: 38, border: "1px solid var(--border)", borderRadius: 8, padding: "0 10px" }} /><button className="btn btn-secondary btn-sm">検索</button></form>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>日時</th><th>操作者</th><th>対象</th><th>操作</th><th>状態変化</th><th>理由・データ</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id}><td className="small">{r.createdAt.toISOString()}</td><td className="small">{r.actorType}<div className="muted">{r.actorId}</div></td><td className="small">{r.objectType}<div className="muted">{r.objectId}</div></td><td>{r.action}</td><td className="small">{r.fromState ?? ""} → {r.toState ?? ""}</td><td className="small">{r.reason}{r.data ? <code style={{ display: "block", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{JSON.stringify(r.data)}</code> : null}</td></tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}
