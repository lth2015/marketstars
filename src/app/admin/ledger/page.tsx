import Link from "next/link";
import { prisma } from "@/lib/db";
import { verifyLedger } from "@/lib/ledger";
import { formatJst } from "@/lib/time";
import { yen } from "@/lib/text";

const KIND: Record<string, string> = { payment: "入金", refund: "返金", payout_paid: "提供会社へ支払" };

export default async function Ledger() {
  const [check, rows, anchors] = await Promise.all([
    verifyLedger(),
    prisma.ledgerEntry.findMany({ orderBy: { seq: "desc" }, take: 100 }),
    prisma.ledgerAnchor.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  return (
    <div className="stack">
      <div className="section-head"><h1 style={{ margin: 0 }}>精算台帳（改ざん検知）</h1><Link className="btn btn-secondary btn-sm" href="/admin/ledger/export">JSON 出力</Link></div>
      <p className="small muted">入金・返金・提供会社への支払いを発生順にハッシュチェーンで記録します（追記のみ）。各記録は直前の記録のハッシュを含むため、過去の記録を書き換えると以降の検証が失敗します。アンカー（先頭ハッシュ）は外部公開やブロックチェーンへの記録に使えますが、<strong>現在はブロックチェーンには接続していません</strong>。</p>
      {check.ok ? <div className="alert alert-ok">検証 OK：{check.count} 件、先頭ハッシュ <code style={{ wordBreak: "break-all" }}>{check.head}</code></div>
        : <div className="alert alert-error" role="alert">検証エラー：#{check.brokenAt} — {check.reason}</div>}
      <h2>アンカー</h2>
      {anchors.length === 0 ? <div className="empty small">アンカーはまだありません（定期処理で作成されます）。</div> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>作成日時</th><th>件数</th><th>ハッシュ</th><th>記録先</th></tr></thead><tbody>
          {anchors.map((a) => <tr key={a.id}><td className="small">{formatJst(a.createdAt, true)}</td><td>#{a.seq}</td><td className="small" style={{ wordBreak: "break-all" }}><code>{a.hash}</code></td><td className="small">{a.target === "none" ? "未記録（オンチェーン未接続）" : `${a.target} ${a.txRef ?? ""}`}</td></tr>)}
        </tbody></table></div>
      )}
      <h2>記録（新しい順・100件）</h2>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>#</th><th>発生</th><th>種別</th><th>金額</th><th>参照</th><th>ハッシュ</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.seq}><td>{r.seq}</td><td className="small">{formatJst(r.occurredAt, true)}</td><td>{KIND[r.kind] ?? r.kind}</td><td>{yen(r.amountJpy)}</td><td className="small">{r.refId}</td><td className="small"><code>{r.hash.slice(0, 16)}…</code></td></tr>)}</tbody>
      </table></div>
    </div>
  );
}
