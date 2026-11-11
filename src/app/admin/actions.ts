"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession, isOperator } from "@/lib/session";
import { audit } from "@/lib/audit";
import { derivePricing } from "@/lib/catalog";
import { draftFromForm, publishApp } from "@/lib/publishing";
import { applyUploads, UploadError } from "@/lib/assets";
import { recomputeRating } from "@/lib/reviews";
import { generatePayouts } from "@/lib/payouts";
import { invalidateCatalog } from "@/lib/cache";
import { emitEvent } from "@/lib/events";

/** 通知开发者（提供商所属空间）。 */
async function emitDeveloperEvent(appId: string, type: string, reason?: string) {
  const app = await prisma.app.findUniqueOrThrow({ where: { id: appId }, include: { provider: true } });
  if (!app.provider.ownerTenantId) return;
  await emitEvent(prisma, { type, tenantId: app.provider.ownerTenantId, appId, payload: { appName: app.name, appId, reason: reason ?? null } });
}
import { BizError, confirmPayment, operatorCancelAtPeriodEnd, rejectApplication, resumeSubscription, suspendSubscription } from "@/lib/subscriptions";

async function requireOperator() {
  const s = await getSession();
  const op = await isOperator(s);
  if (!s || !op) redirect("/admin");
  return { userId: s.userId, name: s.userName, role: op.role };
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const back = (path: string, kind: "msg" | "error", text: string): never => (invalidateCatalog(), redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(text)}`));

export async function createAppAction(fd: FormData) {
  const op = await requireOperator();
  const slug = str(fd, "slug").toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) back("/admin/apps/new", "error", "slug は英小文字・数字・ハイフンで入力してください。");
  if (await prisma.app.findUnique({ where: { slug } })) back("/admin/apps/new", "error", "この slug は使用済みです。");
  const providerId = str(fd, "providerId") || (await prisma.provider.create({ data: { name: str(fd, "newProvider") || "未設定の提供会社" } })).id;
  const app = await prisma.app.create({ data: { slug, name: str(fd, "name") || slug, tagline: "", searchText: "", providerId, status: "draft" } });
  await audit(prisma, { actorId: op.userId, actorType: "operator", objectType: "app", objectId: app.id, action: "create", toState: "draft" });
  redirect(`/admin/apps/${app.id}?msg=${encodeURIComponent("下書きを作成しました。")}`);
}

export async function saveDraftAction(fd: FormData) {
  const op = await requireOperator();
  const id = str(fd, "id");
  const prev = await prisma.app.findUniqueOrThrow({ where: { id } });
  const d = draftFromForm(fd);
  try {
    await applyUploads(fd, d, { type: "operator", id: op.userId });
  } catch (e) {
    if (e instanceof UploadError) back(`/admin/apps/${id}`, "error", e.message);
    throw e;
  }
  // 保留开发者提出的套餐提案
  const prevPlans = (prev.draft as { plans?: unknown } | null)?.plans;
  if (prevPlans) (d as { plans?: unknown }).plans = prevPlans;
  await prisma.app.update({ where: { id }, data: { draft: d as unknown as Prisma.InputJsonValue } });
  await audit(prisma, { actorId: op.userId, actorType: "operator", objectType: "app", objectId: id, action: "save_draft" });
  revalidatePath(`/admin/apps/${id}`);
  back(`/admin/apps/${id}`, "msg", "下書きを保存しました。プレビューで確認してから公開してください。");
}

export async function publishAction(fd: FormData) {
  const op = await requireOperator();
  const id = str(fd, "id");
  const errors = await publishApp(id, op.userId);
  if (errors.length) back(`/admin/apps/${id}`, "error", `公開に必要な項目が不足しています：${errors.join("、")}`);
  revalidatePath("/");
  back(`/admin/apps/${id}`, "msg", "公開しました。");
}

/** 开发者提交审核：通过即发布；拒绝需填写理由，开发者可修改后再次提交。 */
export async function submissionDecisionAction(fd: FormData) {
  const op = await requireOperator();
  const id = str(fd, "id");
  if (str(fd, "decision") === "approve") {
    const errors = await publishApp(id, op.userId, "approve_submission");
    if (errors.length) back("/admin/submissions", "error", `公開できません：${errors.join("、")}`);
    await emitDeveloperEvent(id, "app.submission_approved");
    back("/admin/submissions", "msg", "承認して公開しました。");
  }
  const note = str(fd, "note");
  if (!note) back("/admin/submissions", "error", "差し戻し理由を入力してください。");
  await prisma.app.update({ where: { id }, data: { reviewStatus: "rejected", reviewNote: note } });
  await audit(prisma, { actorId: op.userId, actorType: "operator", objectType: "app", objectId: id, action: "reject_submission", reason: note });
  await emitDeveloperEvent(id, "app.submission_rejected", note);
  back("/admin/submissions", "msg", "差し戻しました。");
}

export async function reviewModerationAction(fd: FormData) {
  const op = await requireOperator();
  const id = str(fd, "id");
  const hide = str(fd, "op") === "hide";
  const r = await prisma.review.update({ where: { id }, data: { status: hide ? "hidden" : "published", hiddenReason: hide ? str(fd, "reason") || "運営判断" : null } });
  await recomputeRating(r.appId);
  await audit(prisma, { actorId: op.userId, actorType: "operator", objectType: "review", objectId: id, action: hide ? "hide" : "show", reason: str(fd, "reason") || null });
  back("/admin/reviews", "msg", hide ? "非表示にしました。" : "再表示しました。");
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
      data: { appId, planKey, version: (prev?.version ?? 0) + 1, name: str(fd, "name") || planKey, priceType, priceJpy, trialDays: priceType === "free" ? 0 : Math.max(0, Math.min(90, Number(fd.get("trialDays")) || 0)), includes: str(fd, "includes"), limits: str(fd, "limits"), externalContractRequired: fd.get("ext") === "on", tokenPriceJpyPerMTok: Math.max(0, Math.floor(Number(fd.get("tokenPrice")) || 0)), sortOrder: Number(fd.get("sortOrder")) || 0 },
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

/** 未入金（due）请求的收款确认，例如请求书払いの按量账单。 */
export async function confirmDueAction(fd: FormData) {
  const op = await requireOperator();
  const id = str(fd, "id");
  const ref = str(fd, "receiptRef");
  const amount = Math.floor(Number(fd.get("amountJpy")));
  const rec = await prisma.billingRecord.findUnique({ where: { id } });
  if (!rec || rec.status !== "due") back("/admin/billing", "error", "未入金の請求ではありません。");
  if (!ref) back("/admin/billing", "error", "入金証憑番号を入力してください。");
  if (amount !== rec!.amountJpy) back("/admin/billing", "error", `金額が請求額（¥${rec!.amountJpy.toLocaleString()}）と一致しません。`);
  try {
    const r = await prisma.billingRecord.updateMany({ where: { id, status: "due" }, data: { status: "paid", receiptRef: ref, paidAmountJpy: amount, paidAt: new Date(), confirmedBy: op.userId } });
    if (r.count) await audit(prisma, { actorId: op.userId, actorType: "operator", tenantId: rec!.tenantId, objectType: "billing", objectId: id, action: "confirm_due", fromState: "due", toState: "paid", data: { receiptRef: ref } });
  } catch {
    back("/admin/billing", "error", "この証憑番号は使用済みです。");
  }
  back("/admin/billing", "msg", "入金を確認しました。");
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

export async function payoutAction(fd: FormData) {
  const op = await requireOperator();
  const kind = str(fd, "op");
  if (kind === "generate") {
    const month = str(fd, "month");
    if (!/^\d{4}-\d{2}$/.test(month)) back("/admin/payouts", "error", "対象月は YYYY-MM で入力してください。");
    let n = 0;
    try { n = await generatePayouts(month, op.userId); } catch (e) { back("/admin/payouts", "error", String((e as Error).message)); }
    back("/admin/payouts", "msg", `${month} の精算書を ${n} 件作成しました（作成済みの精算書は再計算しません）。`);
  }
  if (kind === "paid") {
    const id = str(fd, "id");
    const ref = str(fd, "reference");
    if (!ref) back("/admin/payouts", "error", "振込の参照番号を入力してください。");
    const r = await prisma.payoutStatement.updateMany({ where: { id, status: "confirmed" }, data: { status: "paid", paidAt: new Date(), paidReference: ref } });
    if (r.count) await audit(prisma, { actorId: op.userId, actorType: "operator", objectType: "payout", objectId: id, action: "mark_paid", data: { reference: ref } });
    back("/admin/payouts", "msg", "支払済みにしました。");
  }
  if (kind === "share") {
    const id = str(fd, "providerId");
    const bps = Math.round(Number(fd.get("sharePct")) * 100);
    if (!(bps >= 0 && bps <= 10000)) back("/admin/payouts", "error", "分配率は 0〜100% で入力してください。");
    await prisma.provider.update({ where: { id }, data: { revenueShareBps: bps } });
    await audit(prisma, { actorId: op.userId, actorType: "operator", objectType: "provider", objectId: id, action: "set_revenue_share", data: { bps } });
    back("/admin/payouts", "msg", "分配率を更新しました（次回以降の精算書に適用）。");
  }
}
