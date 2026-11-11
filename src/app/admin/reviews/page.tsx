import { prisma } from "@/lib/db";
import { formatJst } from "@/lib/time";
import { Flash } from "@/components/Flash";
import { Stars } from "@/components/Stars";
import { reviewModerationAction } from "../actions";

export default async function ReviewsAdmin({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const sp = await searchParams;
  const rows = await prisma.review.findMany({ include: { app: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
  return (
    <div className="stack">
      <h1>レビュー管理</h1>
      <p className="small muted">不適切な内容（個人情報、誹謗中傷、宣伝等）は非表示にできます。評価の平均は公開中のレビューのみで再計算されます。</p>
      <Flash msg={sp.msg} error={sp.error} />
      {rows.length === 0 && <div className="empty">レビューはまだありません。</div>}
      {rows.map((r) => (
        <div key={r.id} className="panel">
          <div className="small muted">{r.app.name} ・ {r.tenantName} ・ {r.userName} ・ {formatJst(r.createdAt, true)} {r.status === "hidden" && `・ 非表示（${r.hiddenReason}）`}</div>
          <Stars value={r.rating} count={1} /> <strong>{r.title}</strong>
          <p style={{ whiteSpace: "pre-line" }}>{r.body}</p>
          <form action={reviewModerationAction} className="row">
            <input type="hidden" name="id" value={r.id} />
            {r.status === "published" ? (<><input type="hidden" name="op" value="hide" /><input name="reason" placeholder="非表示の理由" style={{ height: 34, border: "1px solid var(--border)", borderRadius: 8, padding: "0 8px" }} /><button className="btn btn-danger btn-sm">非表示</button></>)
              : (<><input type="hidden" name="op" value="show" /><button className="btn btn-secondary btn-sm">再表示</button></>)}
          </form>
        </div>
      ))}
    </div>
  );
}
