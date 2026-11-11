import { prisma } from "@/lib/db";
import { formatJst } from "@/lib/time";
import { yen } from "@/lib/text";
import { Flash } from "@/components/Flash";
import { SubOps } from "@/components/admin/SubOps";
import { subscriptionOpAction } from "../actions";

export default async function Requests({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const sp = await searchParams;
  const pending = await prisma.subscription.findMany({ where: { status: "pending" }, include: { app: true, request: true }, orderBy: { createdAt: "asc" } });
  const recent = await prisma.subscription.findMany({ where: { kind: "paid", status: { in: ["rejected", "withdrawn"] } }, include: { app: true, request: true }, orderBy: { updatedAt: "desc" }, take: 20 });
  return (
    <div className="stack">
      <h1>申込処理</h1>
      <p className="small muted">有料プランの申込です。契約内容とお支払い（外部の請求書・振込）を確認し、証憑番号と金額を入力して開始してください。金額が契約額と一致しない場合は開始できません。</p>
      <Flash msg={sp.msg} error={sp.error} />
      {pending.length === 0 && <div className="empty">未処理の申込はありません。</div>}
      {pending.map((s) => (
        <div key={s.id} className="panel">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <strong>{s.app.name}</strong> ／ {s.planNameSnapshot} ／ {yen(s.priceJpySnapshot)}／月
              <div className="small muted">空間：{s.tenantName}（{s.tenantId}）・申込者：{s.request?.requestedByName}・申込日時：{formatJst(s.createdAt, true)}・規約版 {s.request?.termsVersion}{s.internalTest ? " ・ 社内テスト" : ""}</div>
              {s.request?.contactNote && <div className="small" style={{ marginTop: 6 }}>連絡事項：{s.request.contactNote}</div>}
              <form action={subscriptionOpAction} className="row" style={{ marginTop: 8 }}>
                <input type="hidden" name="id" value={s.id} /><input type="hidden" name="op" value="note" /><input type="hidden" name="return" value="/admin/requests" />
                <input name="note" defaultValue={s.request?.operatorNote ?? ""} placeholder="運営メモ" style={{ height: 34, border: "1px solid var(--border)", borderRadius: 8, padding: "0 8px" }} />
                <button className="btn btn-ghost btn-sm">メモ保存</button>
              </form>
            </div>
            <SubOps sub={s} ret="/admin/requests" />
          </div>
        </div>
      ))}
      {recent.length > 0 && (
        <>
          <h2>取り下げ・お断り（直近）</h2>
          <div className="table-wrap"><table className="table"><thead><tr><th>アプリ</th><th>空間</th><th>状態</th><th>更新</th><th>メモ</th></tr></thead><tbody>
            {recent.map((s) => <tr key={s.id}><td>{s.app.name}</td><td>{s.tenantName}</td><td>{s.status}</td><td>{formatJst(s.updatedAt, true)}</td><td>{s.request?.operatorNote}</td></tr>)}
          </tbody></table></div>
        </>
      )}
    </div>
  );
}
