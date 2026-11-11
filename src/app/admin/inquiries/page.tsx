import { prisma } from "@/lib/db";
import { formatJst } from "@/lib/time";
import { Flash } from "@/components/Flash";
import { inquiryUpdateAction } from "../actions";

export default async function Inquiries({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const sp = await searchParams;
  const rows = await prisma.inquiry.findMany({ include: { app: true }, orderBy: [{ status: "desc" }, { createdAt: "desc" }], take: 100 });
  return (
    <div className="stack">
      <h1>お問い合わせ</h1>
      <Flash msg={sp.msg} error={sp.error} />
      {rows.length === 0 && <div className="empty">お問い合わせはありません。</div>}
      {rows.map((q) => (
        <div key={q.id} className="panel">
          <div className="small muted">{q.publicNo} ・ {formatJst(q.createdAt, true)} ・ {q.type}{q.app ? ` ・ ${q.app.name}` : ""}{q.tenantId ? ` ・ 空間 ${q.tenantId}` : ""}</div>
          <strong>{q.name}</strong> <span className="small">&lt;{q.email}&gt;</span> {q.company && <span className="small muted">{q.company}</span>}
          <p style={{ whiteSpace: "pre-line" }}>{q.message}</p>
          <form action={inquiryUpdateAction} className="row">
            <input type="hidden" name="id" value={q.id} />
            <select name="status" defaultValue={q.status} style={{ height: 34 }}><option value="open">未対応</option><option value="in_progress">対応中</option><option value="closed">対応済み</option></select>
            <input name="assignee" defaultValue={q.assignee ?? ""} placeholder="担当" style={{ height: 34, width: 120, border: "1px solid var(--border)", borderRadius: 8, padding: "0 8px" }} />
            <input name="note" defaultValue={q.note ?? ""} placeholder="メモ" style={{ height: 34, flex: 1, minWidth: 160, border: "1px solid var(--border)", borderRadius: 8, padding: "0 8px" }} />
            <button className="btn btn-secondary btn-sm">更新</button>
          </form>
        </div>
      ))}
    </div>
  );
}
