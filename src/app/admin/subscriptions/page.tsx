import { prisma } from "@/lib/db";
import { formatJst } from "@/lib/time";
import { yen } from "@/lib/text";
import { Flash } from "@/components/Flash";
import { SubOps } from "@/components/admin/SubOps";
import { StatusBadge } from "@/components/StatusBadge";

export default async function Subs({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string; q?: string; status?: string }> }) {
  const sp = await searchParams;
  const subs = await prisma.subscription.findMany({
    where: {
      ...(sp.status ? { status: sp.status } : {}),
      ...(sp.q ? { OR: [{ tenantName: { contains: sp.q } }, { tenantId: { contains: sp.q } }, { app: { name: { contains: sp.q } } }] } : {}),
      NOT: { tenantId: { startsWith: "synthetic-" } },
    },
    include: { app: true, scheduledPlan: true }, orderBy: { updatedAt: "desc" }, take: 100,
  });
  const ret = `/admin/subscriptions${sp.q || sp.status ? `?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.status ? { status: sp.status } : {}) })}` : ""}`;
  return (
    <div className="stack">
      <h1>契約管理</h1>
      <Flash msg={sp.msg} error={sp.error} />
      <form className="row">
        <input name="q" defaultValue={sp.q} placeholder="空間名・空間ID・アプリ名" style={{ height: 38, border: "1px solid var(--border)", borderRadius: 8, padding: "0 10px" }} />
        <select name="status" defaultValue={sp.status ?? ""} style={{ height: 38 }}><option value="">すべての状態</option>{["pending", "trialing", "active", "cancel_scheduled", "suspended", "expired", "canceled", "rejected", "withdrawn"].map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <button className="btn btn-secondary btn-sm">検索</button>
      </form>
      <p className="small muted">※ 合成デモ空間（ランキング用）は一覧から除外しています。</p>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>空間 / アプリ</th><th>状態</th><th>プラン</th><th>期間</th><th>操作</th></tr></thead>
        <tbody>{subs.map((s) => (
          <tr key={s.id}>
            <td><strong>{s.tenantName}</strong><div className="small muted">{s.app.name}</div></td>
            <td><StatusBadge status={s.status} />{s.suspendedReason && <div className="small muted">{s.suspendedReason}</div>}</td>
            <td>{s.planNameSnapshot}<div className="small muted">{s.kind} ・ {yen(s.priceJpySnapshot)} ・ {s.paymentMode === "card" ? `カード${s.autoRenew ? "・自動更新" : ""}` : "請求書"}</div>{s.lastChargeError && <div className="small" style={{ color: "var(--danger)" }}>{s.lastChargeError}</div>}</td>
            <td className="small">{s.status === "trialing" ? `〜${formatJst(s.trialEndsAt, true)}` : s.currentPeriodEnd ? `${formatJst(s.currentPeriodStart)}〜${formatJst(s.currentPeriodEnd, true)}` : "—"}{s.cancelAt && <div>解約 {formatJst(s.cancelAt, true)}</div>}</td>
            <td><SubOps sub={s} amount={s.scheduledPlan?.priceJpy ?? s.priceJpySnapshot} ret={ret} /></td>
          </tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}
