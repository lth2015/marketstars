import type { CardApp } from "./catalog";

export function appJson(a: CardApp) {
  return {
    slug: a.slug,
    name: a.name,
    tagline: a.tagline,
    provider: a.provider.name,
    icon_url: a.iconUrl,
    categories: a.categories.map((c) => c.slug),
    min_monthly_price_jpy: a.minMonthlyPrice,
    has_free_plan: a.hasFreePlan,
    has_trial: a.hasTrial,
    max_trial_days: a.maxTrialDays,
    recommended: a.recommendWeight > 0,
    first_published_at: a.firstPublishedAt?.toISOString() ?? null,
    plans: a.plans.map((p) => ({ id: p.id, key: p.planKey, version: p.version, name: p.name, price_type: p.priceType, price_jpy: p.priceJpy, trial_days: p.trialDays })),
  };
}
