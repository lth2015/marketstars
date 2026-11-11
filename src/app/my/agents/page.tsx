import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { AGENT_SCOPES, monthSpend } from "@/lib/agentpay";
import { formatJst } from "@/lib/time";
import { yen } from "@/lib/text";
import { Flash } from "@/components/Flash";
import { MandateForm } from "@/components/MandateForm";
import { revokeMandateAction } from "@/app/actions";

export const metadata = { title: "AIエージェントの支払い権限" };
const TX: Record<string, string> = { approved: "承認", denied: "拒否", failed: "失敗", pending: "処理中" };

export default async function Agents({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const sp = await searchParams;
  const s = await getSession();
  if (!s) redirect("/auth/login?returnTo=/my/agents");
  const [mandates, apps, txs] = await Promise.all([
    prisma.agentMandate.findMany({ where: { tenantId: s.tenantId ?? "__none__" }, orderBy: { createdAt: "desc" } }),
    prisma.app.findMany({ where: { status: "published", internalTest: false }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.agentTransaction.findMany({ where: { tenantId: s.tenantId ?? "__none__" }, include: { mandate: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const appName = new Map(apps.map((a) => [a.id, a.name]));
  const spends = await Promise.all(mandates.map((m) => monthSpend(m.id)));
  const now = new Date();
  return (
    <div className="container" style={{ maxWidth: 1000, paddingBottom: 64 }}>
      <div className="breadcrumb"><Link href="/my/apps">マイアプリ</Link> ／ AIエージェント</div>
      <h1 style={{ marginTop: 12 }}>AIエージェントの支払い権限（AgentPay）</h1>
      <p className="muted small">空間「{s.tenantName}」の AI エージェントに、予算・上限・対象アプリを決めてアプリの検索と購入を任せられます。API の使い方は <a href="/api/openapi">OpenAPI</a> の <code>/api/agent/v1</code> を参照してください。</p>
      <Flash msg={sp.msg} error={sp.error} />
      {s.isOwner ? <MandateForm apps={apps} scopes={AGENT_SCOPES} /> : <div className="alert alert-warn">権限の発行は空間のオーナーのみ可能です。</div>}

      <h2 style={{ marginTop: 32 }}>発行済みの権限</h2>
      {mandates.length === 0 ? <div className="empty">まだ発行していません。</div> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>名前 / キー</th><th>今月の利用 / 予算</th><th>1回上限</th><th>対象アプリ</th><th>有効期限</th><th></th></tr></thead>
          <tbody>{mandates.map((m, i) => {
            const active = !m.revokedAt && m.expiresAt > now;
            return (
              <tr key={m.id}>
                <td><strong>{m.name}</strong><div className="small muted"><code>{m.keyPrefix}…</code> ・ {m.scopes.split(",").map((x) => AGENT_SCOPES[x as keyof typeof AGENT_SCOPES] ?? x).join("、")}</div></td>
                <td>{yen(spends[i])} / {yen(m.monthlyBudgetJpy)}</td>
                <td>{yen(m.perTxLimitJpy)}</td>
                <td className="small">{Array.isArray(m.allowedAppIds) ? (m.allowedAppIds as string[]).map((id) => appName.get(id) ?? id).join("、") : "すべて"}</td>
                <td className="small">{m.revokedAt ? `取消済み（${formatJst(m.revokedAt)}）` : m.expiresAt <= now ? "期限切れ" : formatJst(m.expiresAt)}<div className="muted">最終利用 {formatJst(m.lastUsedAt, true)}</div></td>
                <td>{active && s.isOwner && <form action={revokeMandateAction}><input type="hidden" name="id" value={m.id} /><button className="btn btn-danger btn-sm">取り消す</button></form>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}

      <h2 style={{ marginTop: 32 }}>エージェントの購入履歴</h2>
      {txs.length === 0 ? <div className="empty">まだ履歴はありません。</div> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>日時</th><th>エージェント</th><th>アプリ</th><th>金額</th><th>結果</th><th>理由・契約</th></tr></thead>
          <tbody>{txs.map((t) => (
            <tr key={t.id}><td className="small">{formatJst(t.createdAt, true)}</td><td>{t.mandate.name}</td><td>{t.appId ? appName.get(t.appId) ?? "—" : "—"}</td><td>{yen(t.amountJpy)}</td>
              <td><span className={`badge st-${t.status === "approved" ? "active" : t.status === "denied" ? "rejected" : "pending"}`}>{TX[t.status] ?? t.status}</span></td>
              <td className="small">{t.reason}{t.subscriptionId && <Link href={`/my/apps/${t.subscriptionId}`}>契約を見る</Link>}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
