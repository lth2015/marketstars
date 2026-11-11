import type { App, PlanVersion, Subscription } from "@prisma/client";
import type { SessionUser } from "./session";
import { t } from "./messages";
import { isEntitled } from "./subscriptions";

export type Cta = { label: string; href?: string; disabled?: boolean; note?: string; variant?: "primary" | "secondary" };

/** 详情页主按钮状态（PRD 6.2）。 */
export function computeCta(args: {
  app: Pick<App, "slug" | "acceptingNew" | "suspendedReason">;
  plans: PlanVersion[];
  session: SessionUser | null;
  live: Subscription | null;
  trialUsed: boolean;
  lastEnded: Subscription | null;
}): Cta {
  const { app, plans, session, live, trialUsed, lastEnded } = args;
  const base = `/apps/${app.slug}`;
  if (app.suspendedReason) return { label: t.cta.suspended, disabled: true, note: "現在このアプリは一時停止中です。" };
  if (!session) return { label: t.cta.login, href: `/auth/login?returnTo=${encodeURIComponent(base)}` };
  if (live) {
    if (live.status === "pending") return { label: t.cta.pending, href: `/my/apps/${live.id}`, variant: "secondary" };
    if (live.status === "suspended") return { label: t.cta.suspended, href: `/my/apps/${live.id}`, variant: "secondary", note: "運営により一時停止されています。" };
    if (isEntitled(live)) return { label: t.cta.open, href: `/launch/${live.id}` };
  }
  if (!app.acceptingNew) return { label: t.cta.closed, disabled: true, note: "現在、新規のお申し込みを受け付けていません。" };
  if (!session.isOwner) return { label: t.cta.notOwner, disabled: true, note: "お申し込みは空間のオーナーのみ可能です。オーナーにご依頼ください。" };
  const free = plans.find((p) => p.priceType === "free");
  const trial = plans.find((p) => p.trialDays > 0 && p.priceType !== "free");
  if (trialUsed && lastEnded?.kind === "trial") return { label: t.cta.trialEnded, href: `${base}/apply` };
  if (trial && !trialUsed) return { label: t.cta.trial(trial.trialDays), href: `${base}/apply?plan=${trial.id}&mode=trial` };
  if (free) return { label: t.cta.free, href: `${base}/apply?plan=${free.id}&mode=start` };
  return { label: t.cta.apply, href: `${base}/apply` };
}
