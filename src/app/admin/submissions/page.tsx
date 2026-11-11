import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatJst } from "@/lib/time";
import { Flash } from "@/components/Flash";
import type { AppDraft } from "@/lib/publishing";
import { submissionDecisionAction } from "../actions";

export default async function Submissions({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const sp = await searchParams;
  const apps = await prisma.app.findMany({ where: { reviewStatus: "submitted" }, include: { provider: true, plans: { where: { current: true } } }, orderBy: { submittedAt: "asc" } });
  const recent = await prisma.app.findMany({ where: { reviewStatus: { in: ["rejected", "approved"] }, provider: { ownerTenantId: { not: null } } }, include: { provider: true }, orderBy: { updatedAt: "desc" }, take: 10 });
  return (
    <div className="stack">
      <h1>開発者審査</h1>
      <p className="small muted">開発者が提出した新規アプリ・更新の審査です。プレビューで内容を確認し、起動 URL の接続テストを行ってから承認してください。SSO 接入アプリの client ID は承認前に「アプリ管理」で発行・設定します。</p>
      <Flash msg={sp.msg} error={sp.error} />
      {apps.length === 0 && <div className="empty">審査待ちはありません。</div>}
      {apps.map((a) => {
        const d = a.draft as unknown as AppDraft | null;
        return (
          <div key={a.id} className="panel stack">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div><strong>{d?.name ?? a.name}</strong> <span className="small muted">{a.slug} ・ {a.provider.name} ・ {a.status === "published" ? "公開中アプリの更新" : "新規掲載"} ・ 提出 {formatJst(a.submittedAt, true)}</span></div>
              <div className="row"><Link className="btn btn-secondary btn-sm" href={`/apps/${a.slug}?preview=1`} target="_blank">プレビュー</Link><Link className="btn btn-ghost btn-sm" href={`/admin/apps/${a.id}`}>詳細編集</Link></div>
            </div>
            <dl className="dl small">
              <dt>起動 URL</dt><dd>{d?.launchUrl ?? "—"}（{d?.integrationType === "sso_integrated" ? `SSO 接入・client ${d?.launchClientId ?? "未発行"}` : "外部サービス"}）</dd>
              <dt>料金プラン案</dt><dd>{d?.plans?.length ? d.plans.map((p) => `${p.name}${p.retire ? "（終了）" : `：${p.priceType === "monthly" ? `¥${p.priceJpy.toLocaleString()}/月` : p.priceType === "free" ? "無料" : "要問合せ"}${p.trialDays ? `・体験${p.trialDays}日` : ""}`}`).join("、") : a.plans.map((p) => p.name).join("、") || "—"}</dd>
              <dt>規約 / プライバシー</dt><dd>{d?.termsUrl ?? "—"} / {d?.privacyUrl ?? "—"}</dd>
            </dl>
            <div className="row">
              <form action={submissionDecisionAction}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="decision" value="approve" /><button className="btn btn-primary btn-sm">承認して公開</button></form>
              <form action={submissionDecisionAction} className="row"><input type="hidden" name="id" value={a.id} /><input type="hidden" name="decision" value="reject" /><input name="note" placeholder="差し戻し理由（開発者に表示）" required style={{ height: 34, minWidth: 260, border: "1px solid var(--border)", borderRadius: 8, padding: "0 8px" }} /><button className="btn btn-danger btn-sm">差し戻す</button></form>
            </div>
          </div>
        );
      })}
      {recent.length > 0 && <div className="panel small"><strong>最近の審査結果</strong><ul>{recent.map((a) => <li key={a.id}>{a.name}（{a.provider.name}）：{a.reviewStatus === "approved" ? "承認" : `差し戻し — ${a.reviewNote}`}</li>)}</ul></div>}
    </div>
  );
}
