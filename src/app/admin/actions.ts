"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession, isOperator } from "@/lib/session";
import { audit } from "@/lib/audit";
import { buildSearchText, derivePricing } from "@/lib/catalog";
import { isSafeLaunchUrl } from "@/lib/text";
import { BizError, confirmPayment, operatorCancelAtPeriodEnd, rejectApplication, resumeSubscription, suspendSubscription } from "@/lib/subscriptions";

async function requireOperator() {
  const s = await getSession();
  const op = await isOperator(s);
  if (!s || !op) redirect("/admin");
  return { userId: s.userId, name: s.userName, role: op.role };
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const back = (path: string, kind: "msg" | "error", text: string): never => redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(text)}`);

export type AppDraft = {
  name: string; tagline: string; tags: string; iconUrl: string | null; screenshots: { url: string; alt: string }[];
  overview: { problem: string; features: string[]; prerequisites: string; dataNeeds: string; setup: string[]; limitations: string };
  launchUrl: string | null; integrationType: string; launchClientId: string | null; supportChannels: { type: string; value: string }[];
  privacyUrl: string | null; termsUrl: string | null; version: string | null; providerId: string;
  categories: string[]; industries: string[]; integrations: string[];
};

const okImage = (u: string) => /^https:\/\//.test(u) || /^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(u) || u.startsWith("/");

function draftFromForm(fd: FormData): AppDraft {
  const lines = (k: string) => str(fd, k).split("\n").map((x) => x.trim()).filter(Boolean);
  return {
    name: str(fd, "name"), tagline: str(fd, "tagline"), tags: str(fd, "tags"), iconUrl: str(fd, "iconUrl") || null,
    screenshots: lines("screenshots").map((l) => { const [url, alt] = l.split("|"); return { url: url.trim(), alt: (alt ?? "").trim() || "スクリーンショット" }; }),
    overview: { problem: str(fd, "problem"), features: lines("features"), prerequisites: str(fd, "prerequisites"), dataNeeds: str(fd, "dataNeeds"), setup: lines("setup"), limitations: str(fd, "limitations") },
    launchUrl: str(fd, "launchUrl") || null, integrationType: str(fd, "integrationType") === "sso_integrated" ? "sso_integrated" : "external",
    launchClientId: str(fd, "launchClientId") || null,
    supportChannels: [str(fd, "supportEmail") && { type: "email", value: str(fd, "supportEmail") }, str(fd, "supportHours") && { type: "hours", value: str(fd, "supportHours") }].filter(Boolean) as { type: string; value: string }[],
    privacyUrl: str(fd, "privacyUrl") || null, termsUrl: str(fd, "termsUrl") || null, version: str(fd, "version") || null, providerId: str(fd, "providerId"),
    categories: fd.getAll("categories").map(String), industries: fd.getAll("industries").map(String), integrations: fd.getAll("integrations").map(String),
  };
}

function validateDraft(d: AppDraft, plansCount: number): string[] {
  const e: string[] = [];
  if (!d.name) e.push("名称");
  if (!d.iconUrl) e.push("アイコン");
  else if (!okImage(d.iconUrl)) e.push("アイコン URL（https のみ）");
  if (d.screenshots.some((s) => !okImage(s.url))) e.push("スクリーンショット URL（https のみ）");
  if (!d.tagline) e.push("概要（短文）");
  if (!d.providerId) e.push("提供会社");
  if (!d.categories.length) e.push("カテゴリ（1つ以上）");
  if (!d.overview.problem) e.push("概要（解決できること）");
  if (plansCount < 1) e.push("有効なプラン");
  if (!d.supportChannels.length) e.push("サポート方法");
  if (!d.termsUrl || !d.privacyUrl) e.push("利用規約・プライバシーポリシーのリンク");
  if (!d.launchUrl || !isSafeLaunchUrl(d.launchUrl)) e.push("アプリ起動 URL（https）");
  if (d.integrationType === "sso_integrated" && !d.launchClientId) e.push("接入 client ID");
  return e;
}

export async function createAppAction(fd: FormData) {
  const op = await requireOperator();
  const slug = str(fd, "slug").toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) back("/admin/apps/new", "error", "slug は英小文字・数字・ハイフンで入力してください。");
  if (await prisma.app.findUnique({ where: { slug } })) back("/admin/apps/new", "error", "この slug は使用済みです。");
  const providerId = str(fd, "providerId") || (await prisma.provider.create({ data: { name: str(fd, "newProvider") || "未設定の提供会社" } })).id;
  const app = await prisma.app.create({ data: { slug, name: str(fd, "name") || slug, tagline: "", providerId, status: "draft" } });
  await audit(prisma, { actorId: op.userId, actorType: "operator", objectType: "app", objectId: app.id, action: "create", toState: "draft" });
  redirect(`/admin/apps/${app.id}?msg=${encodeURIComponent("下書きを作成しました。")}`);
}

export async function saveDraftAction(fd: FormData) {
  const op = await requireOperator();
  const id = str(fd, "id");
  const d = draftFromForm(fd);
  await prisma.app.update({ where: { id }, data: { draft: d as unknown as Prisma.InputJsonValue } });
  await audit(prisma, { actorId: op.userId, actorType: "operator", objectType: "app", objectId: id, action: "save_draft" });
  revalidatePath(`/admin/apps/${id}`);
  back(`/admin/apps/${id}`, "msg", "下書きを保存しました。プレビューで確認してから公開してください。");
}

export async function publishAction(fd: FormData) {
  const op = await requireOperator();
  const id = str(fd, "id");
  const app = await prisma.app.findUniqueOrThrow({ where: { id }, include: { plans: { where: { current: true } }, provider: true } });
  const d = app.draft as unknown as AppDraft | null;
  if (!d) back(`/admin/apps/${id}`, "error", "公開する下書きがありません。");
  const errors = validateDraft(d!, app.plans.length);
  if (errors.length) back(`/admin/apps/${id}`, "error", `公開に必要な項目が不足しています：${errors.join("、")}`);
  const provider = await prisma.provider.findUniqueOrThrow({ where: { id: d!.providerId } });
  const pricing = derivePricing(app.plans);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const n = await tx.appRelease.count({ where: { appId: id } });
    await tx.app.update({
      where: { id },
      data: {
        name: d!.name, tagline: d!.tagline, tags: d!.tags, iconUrl: d!.iconUrl, screenshots: d!.screenshots, overview: d!.overview,
        launchUrl: d!.launchUrl, integrationType: d!.integrationType, launchClientId: d!.integrationType === "sso_integrated" ? d!.launchClientId : null,
        supportChannels: d!.supportChannels, privacyUrl: d!.privacyUrl, termsUrl: d!.termsUrl, version: d!.version, providerId: d!.providerId,
        searchText: buildSearchText({ name: d!.name, tagline: d!.tagline, tags: d!.tags, providerName: provider.name }),
        categories: { set: d!.categories.map((slug) => ({ slug })) }, industries: { set: d!.industries.map((slug) => ({ slug })) }, integrationTags: { set: d!.integrations.map((slug) => ({ slug })) },
        ...pricing, status: "published", draft: Prisma.DbNull, contentUpdatedAt: now,
        // NEW 按首次发布时间，不因编辑而刷新
        firstPublishedAt: app.firstPublishedAt ?? now,
      },
    });
    await tx.appRelease.create({ data: { appId: id, number: n + 1, snapshot: d as unknown as Prisma.InputJsonValue, publishedBy: op.userId } });
    await audit(tx, { actorId: op.userId, actorType: "operator", objectType: "app", objectId: id, action: "publish", fromState: app.status, toState: "published", data: { release: n + 1 } });
  });
  revalidatePath("/");
  back(`/admin/apps/${id}`, "msg", "公開しました。");
}

export async function appFlagAction(fd: FormData) {
  const op = await requireOperator();
  const id = str(fd, "id");
  const flag = str(fd, "flag");
  const reason = str(fd, "reason");
  const app = await prisma.app.findUniqueOrThrow({ where: { id } });
  const data: Prisma.AppUpdateInput = {};
  if (flag === "stop_new") data.acceptingNew = false;
  else if (flag === "resume_new") data.acceptingNew = true;
  else if (flag === "suspend") { if (!reason) back(`/admin/apps/${id}`, "error", "停止理由を入力してください。"); data.suspendedReason = reason; }
  else if (flag === "unsuspend") data.suspendedReason = null;
  else if (flag === "archive") {
    const live = await prisma.subscription.count({ where: { appId: id, liveKey: { not: null }, internalTest: false } });
    if (live > 0) back(`/admin/apps/${id}`, "error", `有効な契約が ${live} 件あります。先に解約・移行を処理してください。`);
    data.status = "archived";
  } else if (flag === "weight") data.recommendWeight = Math.max(0, Math.min(1000, Number(fd.get("weight")) || 0));
  else if (flag === "internal") data.internalTest = fd.get("value") === "1";
  await prisma.app.update({ where: { id }, data });
  await audit(prisma, { actorId: op.userId, actorType: "operator", objectType: "app", objectId: id, action: flag, fromState: app.status, reason: reason || null, data: flag === "weight" ? { weight: Number(fd.get("weight")) } : undefined });
  if (flag === "suspend") {
    const affected = await prisma.subscription.count({ where: { appId: id, liveKey: { not: null } } });
    back(`/admin/apps/${id}`, "msg", `アプリを一時停止しました。影響を受ける空間：${affected} 件（契約詳細に停止理由が表示されます）。`);
  }
  revalidatePath("/");
  back(`/admin/apps/${id}`, "msg", "更新しました。");
}

/** 套餐：新增或修改都会生成新版本，旧版本停用但保留（已确认订单保留快照）。 */
export async function savePlanAction(fd: FormData) {
  const op = await requireOperator();
  const appId = str(fd, "appId");
  const planKey = str(fd, "planKey").toLowerCase();
  if (!/^[a-z0-9-]{1,40}$/.test(planKey)) back(`/admin/apps/${appId}`, "error", "プランキーは英小文字・数字で入力してください。");
  const priceType = ["free", "monthly", "contact"].includes(str(fd, "priceType")) ? str(fd, "priceType") : "monthly";
  const priceJpy = priceType === "monthly" ? Math.max(0, Math.floor(Number(fd.get("priceJpy")) || 0)) : 0;
  if (priceType === "monthly" && priceJpy <= 0) back(`/admin/apps/${appId}`, "error", "月額料金（税込・円）を入力してください。");
  const prev = await prisma.planVersion.findFirst({ where: { appId, planKey }, orderBy: { version: "desc" } });
  await prisma.$transaction(async (tx) => {
    if (prev) await tx.planVersion.updateMany({ where: { appId, planKey }, data: { current: false } });
    const p = await tx.planVersion.create({
      data: { appId, planKey, version: (prev?.version ?? 0) + 1, name: str(fd, "name") || planKey, priceType, priceJpy, trialDays: priceType === "free" ? 0 : Math.max(0, Math.min(90, Number(fd.get("trialDays")) || 0)), includes: str(fd, "includes"), limits: str(fd, "limits"), externalContractRequired: fd.get("ext") === "on", sortOrder: Number(fd.get("sortOrder")) || 0 },
    });
    const plans = await tx.planVersion.findMany({ where: { appId, current: true } });
    await tx.app.update({ where: { id: appId }, data: derivePricing(plans) });
    await audit(tx, { actorId: op.userId, actorType: "operator", objectType: "plan", objectId: p.id, action: prev ? "new_version" : "create", data: { planKey, version: p.version, priceJpy } });
  });
  back(`/admin/apps/${appId}`, "msg", prev ? "新しい料金版を作成しました（既存契約は申込時の料金のままです）。" : "プランを追加しました。");
}

export async function retirePlanAction(fd: FormData) {
  const op = await requireOperator();
  const appId = str(fd, "appId");
  const id = str(fd, "planId");
  await prisma.planVersion.update({ where: { id }, data: { current: false } });
  const plans = await prisma.planVersion.findMany({ where: { appId, current: true } });
  await prisma.app.update({ where: { id: appId }, data: derivePricing(plans) });
  await audit(prisma, { actorId: op.userId, actorType: "operator", objectType: "plan", objectId: id, action: "retire" });
  back(`/admin/apps/${appId}`, "msg", "プランの受付を終了しました。");
}

export async function taxonomyAction(fd: FormData) {
  const op = await requireOperator();
  const kind = str(fd, "kind") as "category" | "industry" | "integrationTag";
  const opName = str(fd, "op");
  const model = (kind === "category" ? prisma.category : kind === "industry" ? prisma.industry : prisma.integrationTag) as unknown as {
    create: (a: unknown) => Promise<{ id: string }>; update: (a: unknown) => Promise<unknown>; delete: (a: unknown) => Promise<unknown>; findUnique: (a: unknown) => Promise<{ id: string; _count: { apps: number } } | null>;
  };
  try {
    if (opName === "create") {
      const slug = str(fd, "slug").toLowerCase();
      if (!/^[a-z0-9-]{1,40}$/.test(slug)) back("/admin/taxonomy", "error", "slug は英小文字・数字・ハイフンで入力してください。");
      await model.create({ data: { slug, name: str(fd, "name"), sortOrder: Number(fd.get("sortOrder")) || 0 } });
    } else if (opName === "update") {
      await model.update({ where: { id: str(fd, "id") }, data: { name: str(fd, "name"), sortOrder: Number(fd.get("sortOrder")) || 0 } });
    } else if (opName === "delete") {
      const row = await model.findUnique({ where: { id: str(fd, "id") }, include: { _count: { select: { apps: true } } } });
      if (row && row._count.apps > 0) back("/admin/taxonomy", "error", `${row._count.apps} 件のアプリが使用中です。先に別の分類へ移行してください。`);
      await model.delete({ where: { id: str(fd, "id") } });
    }
  } catch (e) {
    if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
    back("/admin/taxonomy", "error", "保存できませんでした（slug の重複など）。");
  }
  await audit(prisma, { actorId: op.userId, actorType: "operator", objectType: kind, objectId: str(fd, "id") || str(fd, "slug"), action: opName });
  revalidatePath("/");
  back("/admin/taxonomy", "msg", "更新しました。");
}

export async function subscriptionOpAction(fd: FormData) {
  const op = await requireOperator();
  const id = str(fd, "id");
  const action = str(fd, "op");
  const ret = str(fd, "return") || "/admin/subscriptions";
  try {
    if (action === "reject") await rejectApplication(op, id, str(fd, "reason") || "運営判断");
    else if (action === "confirm") {
      const r = await confirmPayment(op, id, str(fd, "receiptRef"), Math.floor(Number(fd.get("amountJpy"))), str(fd, "note"));
      if (r.duplicated) back(ret, "msg", "この証憑はすでに確認済みです（重複処理は行っていません）。");
    } else if (action === "suspend") await suspendSubscription(op, id, str(fd, "reason"));
    else if (action === "resume") await resumeSubscription(op, id);
    else if (action === "cancel") await operatorCancelAtPeriodEnd(op, id, str(fd, "reason"));
    else if (action === "note") {
      await prisma.applicationRequest.update({ where: { subscriptionId: id }, data: { operatorNote: str(fd, "note") } });
      await audit(prisma, { actorId: op.userId, actorType: "operator", objectType: "subscription", objectId: id, action: "note" });
    }
  } catch (e) {
    if (e instanceof BizError) back(ret, "error", e.message);
    throw e;
  }
  revalidatePath("/admin");
  back(ret, "msg", "処理しました。");
}

export async function refundAction(fd: FormData) {
  const op = await requireOperator();
  const id = str(fd, "id");
  const note = str(fd, "note");
  if (!note) back("/admin/billing", "error", "返金の証憑・メモを入力してください。");
  const r = await prisma.billingRecord.updateMany({ where: { id, status: "paid" }, data: { status: "refunded", refundedAt: new Date(), note } });
  if (r.count) await audit(prisma, { actorId: op.userId, actorType: "operator", objectType: "billing", objectId: id, action: "refund", fromState: "paid", toState: "refunded", reason: note });
  back("/admin/billing", "msg", r.count ? "返金済みとして記録しました（利用期間は変更されません。必要に応じて契約を停止してください）。" : "変更はありません。");
}

export async function inquiryUpdateAction(fd: FormData) {
  const op = await requireOperator();
  const id = str(fd, "id");
  const status = ["open", "in_progress", "closed"].includes(str(fd, "status")) ? str(fd, "status") : "open";
  await prisma.inquiry.update({ where: { id }, data: { status, assignee: str(fd, "assignee") || null, note: str(fd, "note") || null } });
  await audit(prisma, { actorId: op.userId, actorType: "operator", objectType: "inquiry", objectId: id, action: "update", toState: status });
  back("/admin/inquiries", "msg", "更新しました。");
}

export async function contentSaveAction(fd: FormData) {
  const op = await requireOperator();
  const id = str(fd, "id");
  const data = { kind: str(fd, "kind"), slug: str(fd, "slug"), title: str(fd, "title"), summary: str(fd, "summary") || null, body: str(fd, "body"), version: str(fd, "version") || "1", published: fd.get("published") === "on", sortOrder: Number(fd.get("sortOrder")) || 0, appId: str(fd, "appId") || null };
  if (!data.slug || !data.title) back("/admin/content", "error", "slug とタイトルは必須です。");
  try {
    const row = id ? await prisma.contentEntry.update({ where: { id }, data }) : await prisma.contentEntry.create({ data });
    await audit(prisma, { actorId: op.userId, actorType: "operator", objectType: "content", objectId: row.id, action: id ? "update" : "create" });
  } catch (e) {
    if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
    back("/admin/content", "error", "保存できませんでした（同じ種別・slug が存在します）。");
  }
  revalidatePath("/");
  back("/admin/content", "msg", "保存しました。");
}

export async function providerSaveAction(fd: FormData) {
  const op = await requireOperator();
  const id = str(fd, "id");
  const data = { name: str(fd, "name"), websiteUrl: str(fd, "websiteUrl") || null, supportUrl: str(fd, "supportUrl") || null, supportEmail: str(fd, "supportEmail") || null };
  if (!data.name) back("/admin/content", "error", "提供会社名は必須です。");
  const row = id ? await prisma.provider.update({ where: { id }, data }) : await prisma.provider.create({ data });
  await audit(prisma, { actorId: op.userId, actorType: "operator", objectType: "provider", objectId: row.id, action: id ? "update" : "create" });
  back("/admin/content", "msg", "提供会社を保存しました。");
}
