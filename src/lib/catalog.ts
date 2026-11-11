import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { normalizeSearch } from "./text";
import { memo } from "./cache";

const CATALOG_TTL = Number(process.env.CATALOG_CACHE_SECONDS ?? 15);

export const PAGE_SIZES = [10, 30, 50] as const;
export const SORTS = { recommended: "おすすめ順", new: "新着順", price: "価格の安い順" } as const;
export type SortKey = keyof typeof SORTS;

export type ListQuery = {
  q: string;
  category: string[];
  industry: string[];
  integration: string[];
  free: boolean;
  trial: boolean;
  recommended: boolean;
  sort: SortKey;
  perPage: number;
  page: number;
};

type SP = Record<string, string | string[] | undefined>;
const arr = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : v.split(",")).filter(Boolean);
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseListQuery(sp: SP): ListQuery {
  const sort = one(sp.sort) as SortKey;
  const perPage = Number(one(sp.per));
  const page = Math.max(1, Math.floor(Number(one(sp.page)) || 1));
  return {
    q: one(sp.q).trim().slice(0, 100),
    category: arr(sp.category),
    industry: arr(sp.industry),
    integration: arr(sp.integration),
    free: one(sp.free) === "true",
    trial: one(sp.trial) === "true",
    recommended: one(sp.recommended) === "true",
    sort: sort in SORTS ? sort : "recommended",
    perPage: (PAGE_SIZES as readonly number[]).includes(perPage) ? perPage : 30,
    page,
  };
}

export function queryToSearchParams(q: ListQuery, patch: Partial<ListQuery> = {}): string {
  const m = { ...q, ...patch };
  const p = new URLSearchParams();
  if (m.q) p.set("q", m.q);
  for (const k of ["category", "industry", "integration"] as const) for (const v of m[k]) p.append(k, v);
  if (m.free) p.set("free", "true");
  if (m.trial) p.set("trial", "true");
  if (m.recommended) p.set("recommended", "true");
  if (m.sort !== "recommended") p.set("sort", m.sort);
  if (m.perPage !== 30) p.set("per", String(m.perPage));
  if (m.page > 1) p.set("page", String(m.page));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const publicAppWhere: Prisma.AppWhereInput = { status: "published", internalTest: false };

export const cardInclude = {
  provider: { select: { name: true } },
  categories: { select: { slug: true, name: true }, orderBy: { sortOrder: "asc" as const } },
  plans: { where: { current: true }, orderBy: { sortOrder: "asc" as const } },
} satisfies Prisma.AppInclude;

export type CardApp = Prisma.AppGetPayload<{ include: typeof cardInclude }>;

function orderBy(sort: SortKey): Prisma.AppOrderByWithRelationInput[] {
  if (sort === "new") return [{ firstPublishedAt: "desc" }, { id: "asc" }];
  if (sort === "price") return [{ minMonthlyPrice: { sort: "asc", nulls: "last" } }, { firstPublishedAt: "asc" }, { id: "asc" }];
  return [{ recommendWeight: "desc" }, { firstPublishedAt: "desc" }, { id: "asc" }];
}

export function listApps(q: ListQuery) {
  return memo(`list:${JSON.stringify(q)}`, CATALOG_TTL, () => listAppsUncached(q));
}

async function listAppsUncached(q: ListQuery) {
  const and: Prisma.AppWhereInput[] = [publicAppWhere];
  if (q.q) {
    for (const term of normalizeSearch(q.q).split(" ").filter(Boolean)) and.push({ searchText: { contains: term } });
  }
  // 同一维度内 OR，不同维度之间 AND
  if (q.category.length) and.push({ categories: { some: { slug: { in: q.category } } } });
  if (q.industry.length) and.push({ industries: { some: { slug: { in: q.industry } } } });
  if (q.integration.length) and.push({ integrationTags: { some: { slug: { in: q.integration } } } });
  if (q.free) and.push({ hasFreePlan: true });
  if (q.trial) and.push({ hasTrial: true });
  if (q.recommended) and.push({ recommendWeight: { gt: 0 } });
  const where: Prisma.AppWhereInput = { AND: and };
  const [total, items] = await Promise.all([
    prisma.app.count({ where }),
    prisma.app.findMany({ where, include: cardInclude, orderBy: orderBy(q.sort), skip: (q.page - 1) * q.perPage, take: q.perPage }),
  ]);
  return { total, items, pages: Math.max(1, Math.ceil(total / q.perPage)) };
}

export function facets() {
  return memo("facets", CATALOG_TTL, facetsUncached);
}

async function facetsUncached() {
  const [categories, industries, integrations] = await Promise.all([
    prisma.category.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.industry.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.integrationTag.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  return { categories, industries, integrations };
}

export function isNew(app: { firstPublishedAt: Date | null }, now = new Date()) {
  return !!app.firstPublishedAt && now.getTime() - app.firstPublishedAt.getTime() < 30 * 86400000;
}

/** 当前可申请的最低固定月费：免费=0，要咨询不计；全部要咨询则 null（排序置后）。 */
export function derivePricing(plans: { priceType: string; priceJpy: number; trialDays: number }[]) {
  const prices = plans.filter((p) => p.priceType !== "contact").map((p) => (p.priceType === "free" ? 0 : p.priceJpy));
  return {
    minMonthlyPrice: prices.length ? Math.min(...prices) : null,
    hasFreePlan: plans.some((p) => p.priceType === "free"),
    hasTrial: plans.some((p) => p.trialDays > 0 && p.priceType !== "free"),
    maxTrialDays: Math.max(0, ...plans.map((p) => (p.priceType === "free" ? 0 : p.trialDays))),
  };
}

export function buildSearchText(a: { name: string; tagline: string; tags: string; providerName: string }) {
  return normalizeSearch([a.name, a.tagline, a.providerName, a.tags].join(" "));
}

/** 排行：最近30天新增的有效开通租户数（不含试用、内部测试、拒绝/撤回），同租户同应用只计一次。 */
export async function computeRanking(now = new Date()) {
  const since = new Date(now.getTime() - 30 * 86400000);
  const subs = await prisma.subscription.findMany({
    where: {
      startedAt: { gte: since },
      kind: { in: ["free", "paid"] },
      internalTest: false,
      status: { in: ["active", "cancel_scheduled", "suspended", "expired", "canceled"] },
      app: publicAppWhere,
    },
    select: { appId: true, tenantId: true },
  });
  const counts = new Map<string, Set<string>>();
  for (const s of subs) {
    if (!counts.has(s.appId)) counts.set(s.appId, new Set());
    counts.get(s.appId)!.add(s.tenantId);
  }
  const apps = await prisma.app.findMany({ where: { id: { in: [...counts.keys()] } }, select: { id: true, firstPublishedAt: true } });
  const rows = apps
    .map((a) => ({ appId: a.id, count: counts.get(a.id)!.size, pub: a.firstPublishedAt?.getTime() ?? 0 }))
    .sort((x, y) => y.count - x.count || x.pub - y.pub || x.appId.localeCompare(y.appId));
  await prisma.$transaction([
    prisma.rankingEntry.deleteMany({}),
    prisma.rankingEntry.createMany({ data: rows.map((r, i) => ({ appId: r.appId, rank: i + 1, count: r.count, computedAt: now })) }),
  ]);
  return rows.length;
}

export function getRanking(category?: string) {
  return memo(`ranking:${category ?? ""}`, CATALOG_TTL, () => getRankingUncached(category));
}

async function getRankingUncached(category?: string) {
  const entries = await prisma.rankingEntry.findMany({
    where: { app: { ...publicAppWhere, ...(category ? { categories: { some: { slug: category } } } : {}) } },
    include: { app: { include: cardInclude } },
    orderBy: [{ rank: "asc" }],
  });
  const computedAt = entries[0]?.computedAt ?? (await prisma.rankingEntry.findFirst())?.computedAt ?? null;
  return { entries: entries.map((e, i) => ({ ...e, rank: i + 1 })), computedAt };
}
