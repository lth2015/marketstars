// 应用草稿、校验与发布（运营直接发布与开发者提交审核通过共用）。
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { audit } from "./audit";
import { buildSearchText, derivePricing } from "./catalog";
import { isSafeLaunchUrl } from "./text";

export type PlanProposal = { key: string; name: string; priceType: "free" | "monthly" | "contact"; priceJpy: number; trialDays: number; includes: string; limits: string; ext: boolean; sortOrder: number; retire?: boolean; tokenPrice?: number };

export type AppDraft = {
  name: string; tagline: string; tags: string; iconUrl: string | null; screenshots: { url: string; alt: string }[];
  overview: { problem: string; features: string[]; prerequisites: string; dataNeeds: string; setup: string[]; limitations: string };
  launchUrl: string | null; integrationType: string; launchClientId: string | null; supportChannels: { type: string; value: string }[];
  privacyUrl: string | null; termsUrl: string | null; version: string | null; providerId: string;
  categories: string[]; industries: string[]; integrations: string[];
  /** 开发者提出的套餐（审核通过后生成不可变价格版本） */
  plans?: PlanProposal[];
};

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
export const okImage = (u: string) => /^https:\/\//.test(u) || /^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(u) || u.startsWith("/");

export function draftFromForm(fd: FormData, fixed: { providerId?: string; launchClientId?: string | null } = {}): AppDraft {
  const lines = (k: string) => str(fd, k).split("\n").map((x) => x.trim()).filter(Boolean);
  const d: AppDraft = {
    name: str(fd, "name"), tagline: str(fd, "tagline"), tags: str(fd, "tags"), iconUrl: str(fd, "iconUrl") || null,
    screenshots: lines("screenshots").map((l) => { const [url, alt] = l.split("|"); return { url: url.trim(), alt: (alt ?? "").trim() || "スクリーンショット" }; }),
    overview: { problem: str(fd, "problem"), features: lines("features"), prerequisites: str(fd, "prerequisites"), dataNeeds: str(fd, "dataNeeds"), setup: lines("setup"), limitations: str(fd, "limitations") },
    launchUrl: str(fd, "launchUrl") || null, integrationType: str(fd, "integrationType") === "sso_integrated" ? "sso_integrated" : "external",
    launchClientId: fixed.launchClientId !== undefined ? fixed.launchClientId : str(fd, "launchClientId") || null,
    supportChannels: [str(fd, "supportEmail") && { type: "email", value: str(fd, "supportEmail") }, str(fd, "supportHours") && { type: "hours", value: str(fd, "supportHours") }].filter(Boolean) as { type: string; value: string }[],
    privacyUrl: str(fd, "privacyUrl") || null, termsUrl: str(fd, "termsUrl") || null, version: str(fd, "version") || null, providerId: fixed.providerId ?? str(fd, "providerId"),
    categories: fd.getAll("categories").map(String), industries: fd.getAll("industries").map(String), integrations: fd.getAll("integrations").map(String),
  };
  const n = Number(fd.get("plan_count") ?? 0);
  if (n > 0) {
    const plans: PlanProposal[] = [];
    for (let i = 0; i < n; i++) {
      const key = str(fd, `plan_${i}_key`).toLowerCase();
      if (!key) continue;
      const priceType = (["free", "monthly", "contact"].includes(str(fd, `plan_${i}_priceType`)) ? str(fd, `plan_${i}_priceType`) : "monthly") as PlanProposal["priceType"];
      plans.push({
        key, name: str(fd, `plan_${i}_name`) || key, priceType,
        priceJpy: priceType === "monthly" ? Math.max(0, Math.floor(Number(fd.get(`plan_${i}_priceJpy`)) || 0)) : 0,
        trialDays: priceType === "free" ? 0 : Math.max(0, Math.min(90, Number(fd.get(`plan_${i}_trialDays`)) || 0)),
        includes: str(fd, `plan_${i}_includes`), limits: str(fd, `plan_${i}_limits`), ext: fd.get(`plan_${i}_ext`) === "on", sortOrder: i, retire: fd.get(`plan_${i}_retire`) === "on",
        tokenPrice: Math.max(0, Math.min(100000, Math.floor(Number(fd.get(`plan_${i}_tokenPrice`)) || 0))),
      });
    }
    d.plans = plans;
  }
  return d;
}

export function validateDraft(d: AppDraft, currentPlanCount: number): string[] {
  const e: string[] = [];
  if (!d.name) e.push("名称");
  if (!d.iconUrl) e.push("アイコン");
  else if (!okImage(d.iconUrl)) e.push("アイコン URL（https のみ）");
  if (d.screenshots.some((s) => !okImage(s.url))) e.push("スクリーンショット URL（https のみ）");
  if (!d.tagline) e.push("概要（短文）");
  if (!d.providerId) e.push("提供会社");
  if (!d.categories.length) e.push("カテゴリ（1つ以上）");
  if (!d.overview.problem) e.push("概要（解決できること）");
  const planCount = d.plans ? d.plans.filter((p) => !p.retire).length : currentPlanCount;
  if (planCount < 1) e.push("有効なプラン");
  if (d.plans?.some((p) => !p.retire && p.priceType === "monthly" && p.priceJpy <= 0)) e.push("月額料金（1円以上）");
  if (d.plans?.some((p) => !/^[a-z0-9-]{1,40}$/.test(p.key))) e.push("プランキー（英小文字・数字）");
  if (!d.supportChannels.length) e.push("サポート方法");
  if (!d.termsUrl || !d.privacyUrl) e.push("利用規約・プライバシーポリシーのリンク");
  if (!d.launchUrl || !isSafeLaunchUrl(d.launchUrl)) e.push("アプリ起動 URL（https）");
  if (d.integrationType === "sso_integrated" && !d.launchClientId) e.push("接入 client ID（運営が発行）");
  return e;
}

/** 把提案套餐应用为价格版本：内容变化才生成新版本；retire 停止受理。 */
async function applyPlanProposals(tx: Prisma.TransactionClient, appId: string, plans: PlanProposal[], actorId: string) {
  const current = await tx.planVersion.findMany({ where: { appId, current: true } });
  for (const p of plans) {
    const cur = current.find((c) => c.planKey === p.key);
    if (p.retire) {
      if (cur) await tx.planVersion.update({ where: { id: cur.id }, data: { current: false } });
      continue;
    }
    const same = cur && cur.name === p.name && cur.priceType === p.priceType && cur.priceJpy === p.priceJpy && cur.trialDays === p.trialDays && cur.includes === p.includes && cur.limits === p.limits && cur.externalContractRequired === p.ext && cur.tokenPriceJpyPerMTok === (p.tokenPrice ?? 0);
    if (same) { if (cur.sortOrder !== p.sortOrder) await tx.planVersion.update({ where: { id: cur.id }, data: { sortOrder: p.sortOrder } }); continue; }
    const last = await tx.planVersion.findFirst({ where: { appId, planKey: p.key }, orderBy: { version: "desc" } });
    if (cur) await tx.planVersion.update({ where: { id: cur.id }, data: { current: false } });
    const v = await tx.planVersion.create({ data: { appId, planKey: p.key, version: (last?.version ?? 0) + 1, name: p.name, priceType: p.priceType, priceJpy: p.priceJpy, trialDays: p.trialDays, includes: p.includes, limits: p.limits, externalContractRequired: p.ext, tokenPriceJpyPerMTok: p.tokenPrice ?? 0, sortOrder: p.sortOrder } });
    await audit(tx, { actorId, actorType: "operator", objectType: "plan", objectId: v.id, action: cur ? "new_version" : "create", data: { planKey: p.key, version: v.version, priceJpy: p.priceJpy } });
  }
}

/** 发布草稿。返回缺失项（非空则未发布）。 */
export async function publishApp(appId: string, actorId: string, action = "publish"): Promise<string[]> {
  const app = await prisma.app.findUniqueOrThrow({ where: { id: appId }, include: { plans: { where: { current: true } } } });
  const d = app.draft as unknown as AppDraft | null;
  if (!d) return ["公開する下書き"];
  const errors = validateDraft(d, app.plans.length);
  if (errors.length) return errors;
  const provider = await prisma.provider.findUniqueOrThrow({ where: { id: d.providerId } });
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    if (d.plans) await applyPlanProposals(tx, appId, d.plans, actorId);
    const plans = await tx.planVersion.findMany({ where: { appId, current: true } });
    const n = await tx.appRelease.count({ where: { appId } });
    await tx.app.update({
      where: { id: appId },
      data: {
        name: d.name, tagline: d.tagline, tags: d.tags, iconUrl: d.iconUrl, screenshots: d.screenshots, overview: d.overview,
        launchUrl: d.launchUrl, integrationType: d.integrationType, launchClientId: d.integrationType === "sso_integrated" ? d.launchClientId : null,
        supportChannels: d.supportChannels, privacyUrl: d.privacyUrl, termsUrl: d.termsUrl, version: d.version, providerId: d.providerId,
        searchText: buildSearchText({ name: d.name, tagline: d.tagline, tags: d.tags, providerName: provider.name }),
        categories: { set: d.categories.map((slug) => ({ slug })) }, industries: { set: d.industries.map((slug) => ({ slug })) }, integrationTags: { set: d.integrations.map((slug) => ({ slug })) },
        ...derivePricing(plans), status: "published", draft: Prisma.DbNull, contentUpdatedAt: now,
        reviewStatus: app.reviewStatus === "submitted" ? "approved" : app.reviewStatus, submittedAt: null,
        // NEW 按首次发布时间，不因编辑而刷新
        firstPublishedAt: app.firstPublishedAt ?? now,
      },
    });
    await tx.appRelease.create({ data: { appId, number: n + 1, snapshot: d as unknown as Prisma.InputJsonValue, publishedBy: actorId } });
    await audit(tx, { actorId, actorType: "operator", objectType: "app", objectId: appId, action, fromState: app.status, toState: "published", data: { release: n + 1 } });
  });
  return [];
}

/** 已发布内容 → 草稿初始值。 */
export function draftFromApp(app: Prisma.AppGetPayload<{ include: { categories: true; industries: true; integrationTags: true } }>, plans?: { planKey: string; name: string; priceType: string; priceJpy: number; trialDays: number; includes: string; limits: string; externalContractRequired: boolean; sortOrder: number; tokenPriceJpyPerMTok: number }[]): AppDraft {
  if (app.draft) return app.draft as unknown as AppDraft;
  const ov = (app.overview ?? {}) as Partial<AppDraft["overview"]>;
  return {
    name: app.name, tagline: app.tagline, tags: app.tags, iconUrl: app.iconUrl, screenshots: (app.screenshots ?? []) as AppDraft["screenshots"],
    overview: { problem: ov.problem ?? "", features: ov.features ?? [], prerequisites: ov.prerequisites ?? "", dataNeeds: ov.dataNeeds ?? "", setup: ov.setup ?? [], limitations: ov.limitations ?? "" },
    launchUrl: app.launchUrl, integrationType: app.integrationType, launchClientId: app.launchClientId, supportChannels: (app.supportChannels ?? []) as AppDraft["supportChannels"],
    privacyUrl: app.privacyUrl, termsUrl: app.termsUrl, version: app.version, providerId: app.providerId,
    categories: app.categories.map((c) => c.slug), industries: app.industries.map((c) => c.slug), integrations: app.integrationTags.map((c) => c.slug),
    ...(plans ? { plans: plans.map((p) => ({ key: p.planKey, name: p.name, priceType: p.priceType as PlanProposal["priceType"], priceJpy: p.priceJpy, trialDays: p.trialDays, includes: p.includes, limits: p.limits, ext: p.externalContractRequired, sortOrder: p.sortOrder, tokenPrice: p.tokenPriceJpyPerMTok })) } : {}),
  };
}
