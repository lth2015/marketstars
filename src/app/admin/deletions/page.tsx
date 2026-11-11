import { prisma } from "@/lib/db";
import { formatJst } from "@/lib/time";
import { Flash } from "@/components/Flash";
import { DELETION_STATUS, type Check } from "@/lib/deletion";
import { deletionUpdateAction } from "../actions";

const NEXT: Record<string, { to: string; label: string; variant: string }[]> = {
  submitted: [{ to: "in_review", label: "確認を開始", variant: "btn-secondary" }, { to: "rejected", label: "お断り", variant: "btn-danger" }],
  in_review: [{ to: "forwarded_to_sso", label: "SSO に引き継ぐ", variant: "btn-primary" }, { to: "rejected", label: "お断り", variant: "btn-danger" }],
  forwarded_to_sso: [{ to: "closed", label: "完了にする", variant: "btn-secondary" }],
};

export default async function Deletions({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const sp = await searchParams;
  const rows = await prisma.deletionRequest.findMany({ orderBy: [{ createdAt: "desc" }], take: 100 });
  const inp = { height: 34, border: "1px solid var(--border)", borderRadius: 8, padding: "0 8px" } as const;
  return (
    <div className="stack">
      <h1>アカウント削除申請</h1>
      <p className="small muted">MarketStars ではアカウント・空間・取引記録を削除しません。内容を確認し、共通 SSO の削除手続きへ引き継いで、受付番号を記録してください。未払い・有料契約が残っている申請は利用者側で受け付けません。</p>
      <Flash msg={sp.msg} error={sp.error} />
      {rows.length === 0 && <div className="empty">申請はありません。</div>}
      {rows.map((r) => (
        <div key={r.id} className="panel stack">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div><strong>{r.userName}</strong> <span className="small muted">{r.email ?? "—"} ・ user {r.userId} ・ 空間 {r.tenantName ?? "—"}</span></div>
            <span className="tag">{DELETION_STATUS[r.status] ?? r.status}</span>
          </div>
          <div className="small muted">申請 {formatJst(r.createdAt, true)}{r.ssoTicketRef ? ` ・ SSO 受付番号 ${r.ssoTicketRef}` : ""}{r.reason ? ` ・ 理由：${r.reason}` : ""}</div>
          <details className="small"><summary>申請時の確認結果</summary><ul>{(r.checks as Check[]).map((c) => <li key={c.key}>{c.ok ? "OK" : c.blocking ? "要対応" : "確認"}：{c.title} — {c.detail}</li>)}</ul></details>
          {(NEXT[r.status] ?? []).length > 0 && (
            <div className="row">
              {NEXT[r.status].map((n) => (
                <form key={n.to} action={deletionUpdateAction} className="row">
                  <input type="hidden" name="id" value={r.id} /><input type="hidden" name="to" value={n.to} />
                  {n.to === "forwarded_to_sso" && <input name="ssoTicketRef" placeholder="SSO 受付番号（必須）" required style={inp} />}
                  {n.to === "rejected" && <input name="note" placeholder="理由（利用者に表示）" required style={inp} />}
                  <button className={`btn btn-sm ${n.variant}`}>{n.label}</button>
                </form>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
