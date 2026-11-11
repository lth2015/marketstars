import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { isEntitled } from "@/lib/subscriptions";
import { formatJst } from "@/lib/time";
import { StatusBadge } from "@/components/StatusBadge";
import { getMessages } from "@/lib/messages";

export async function generateMetadata() {
  return { title: (await getMessages()).ui.myApps.title };
}

const GROUPS = [
  { key: "using", statuses: ["active", "cancel_scheduled", "suspended"] },
  { key: "trial", statuses: ["trialing"] },
  { key: "pending", statuses: ["pending"] },
  { key: "ended", statuses: ["expired", "canceled", "rejected", "withdrawn"] },
] as const;

export default async function MyApps() {
  const s = await getSession();
  if (!s) redirect("/auth/login?returnTo=/my/apps");
  const t = await getMessages();
  const M = t.ui.myApps;
  const subs = await prisma.subscription.findMany({
    where: { tenantId: s.tenantId ?? "__none__" },
    include: { app: { select: { name: true, slug: true, iconUrl: true, integrationType: true } } },
    orderBy: { createdAt: "desc" },
  });
  return (
    <div className="container" style={{ paddingBottom: 64 }}>
      <div className="breadcrumb"><Link href="/">{t.nav.home}</Link> ／ {M.title}</div>
      <div className="section-head" style={{ marginTop: 12 }}>
        <div><h1 style={{ marginBottom: 4 }}>{M.title}</h1><div className="muted small">{M.space}：<strong>{s.tenantName}</strong>（{s.isOwner ? M.owner : M.member}） <a href="/auth/switch?returnTo=/my/apps">{M.switch}</a></div></div>
        <div className="row"><Link href="/my/agents" className="btn btn-ghost btn-sm">{M.agents}</Link><Link href="/my/billing" className="btn btn-secondary btn-sm">{M.billing}</Link></div>
      </div>
      {subs.length === 0 && <div className="empty"><p>{M.empty}</p><Link className="btn btn-primary" href="/apps">{M.findApps}</Link></div>}
      {GROUPS.map((g) => {
        const list = subs.filter((x) => (g.statuses as readonly string[]).includes(x.status));
        if (!list.length) return null;
        return (
          <section key={g.key} className="section" style={{ paddingTop: 32 }}>
            <h2>{M.groups[g.key]}</h2>
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
                        {sub.status === "trialing" && ` ・ ${M.trialEnds(formatJst(sub.trialEndsAt, true))}`}
                        {sub.kind === "paid" && sub.currentPeriodEnd && ` ・ ${M.periodEnds(formatJst(sub.currentPeriodEnd, true))}`}
                        {sub.status === "cancel_scheduled" && ` ・ ${M.cancelAt(formatJst(sub.cancelAt, true))}`}
                        {sub.status === "pending" && ` ・ ${M.pendingNote}`}
                      </div>
                    </div>
                    <div className="row">
                      {ok && <a className="btn btn-primary btn-sm" href={`/launch/${sub.id}`}>{M.open}</a>}
                      <Link className="btn btn-secondary btn-sm" href={`/my/apps/${sub.id}`}>{M.contract}</Link>
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
