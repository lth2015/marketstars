import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { isEntitled } from "@/lib/subscriptions";
import { formatJst } from "@/lib/time";
import { StatusBadge } from "@/components/StatusBadge";

export const metadata = { title: "マイアプリ" };

const GROUPS = [
  { key: "using", title: "利用中", statuses: ["active", "cancel_scheduled", "suspended"] },
  { key: "trial", title: "無料体験中", statuses: ["trialing"] },
  { key: "pending", title: "申込中", statuses: ["pending"] },
  { key: "ended", title: "終了", statuses: ["expired", "canceled", "rejected", "withdrawn"] },
];

export default async function MyApps() {
  const s = await getSession();
  if (!s) redirect("/auth/login?returnTo=/my/apps");
  const subs = await prisma.subscription.findMany({
    where: { tenantId: s.tenantId ?? "__none__" },
    include: { app: { select: { name: true, slug: true, iconUrl: true, integrationType: true } } },
    orderBy: { createdAt: "desc" },
  });
  return (
    <div className="container" style={{ paddingBottom: 64 }}>
      <div className="breadcrumb"><Link href="/">ホーム</Link> ／ マイアプリ</div>
      <div className="section-head" style={{ marginTop: 12 }}>
        <div><h1 style={{ marginBottom: 4 }}>マイアプリ</h1><div className="muted small">空間：<strong>{s.tenantName}</strong>（{s.isOwner ? "オーナー" : "メンバー"}） <Link href="/auth/switch?returnTo=/my/apps">切り替える</Link></div></div>
        <div className="row"><Link href="/my/agents" className="btn btn-ghost btn-sm">AIエージェント</Link><Link href="/my/billing" className="btn btn-secondary btn-sm">請求・お支払い</Link></div>
      </div>
      {subs.length === 0 && <div className="empty"><p>この空間で利用中のアプリはまだありません。</p><Link className="btn btn-primary" href="/apps">アプリを探す</Link></div>}
      {GROUPS.map((g) => {
        const list = subs.filter((x) => g.statuses.includes(x.status));
        if (!list.length) return null;
        return (
          <section key={g.key} className="section" style={{ paddingTop: 32 }}>
            <h2>{g.title}</h2>
            <div className="stack">
              {list.map((sub) => {
                const ok = isEntitled(sub);
                return (
                  <div key={sub.id} className="panel" style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="app-icon" src={sub.app.iconUrl ?? "/placeholder-icon.svg"} alt="" style={{ width: 56, height: 56 }} />
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <div className="row"><strong>{sub.app.name}</strong><StatusBadge status={sub.status} /></div>
                      <div className="small muted">
                        {sub.planNameSnapshot}
                        {sub.status === "trialing" && ` ・ 体験終了 ${formatJst(sub.trialEndsAt, true)}`}
                        {sub.kind === "paid" && sub.currentPeriodEnd && ` ・ 期間終了 ${formatJst(sub.currentPeriodEnd, true)}`}
                        {sub.status === "cancel_scheduled" && ` ・ 解約予定 ${formatJst(sub.cancelAt, true)}`}
                        {sub.status === "pending" && " ・ 運営が契約・お支払いを確認中です"}
                      </div>
                    </div>
                    <div className="row">
                      {ok && <Link className="btn btn-primary btn-sm" href={`/launch/${sub.id}`}>アプリを開く</Link>}
                      <Link className="btn btn-secondary btn-sm" href={`/my/apps/${sub.id}`}>契約内容</Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
