"use server";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { audit } from "@/lib/audit";
import { developerApp, getDeveloper } from "@/lib/developer";
import { draftFromApp, draftFromForm, validateDraft } from "@/lib/publishing";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const go = (path: string, kind: "msg" | "error", text: string): never => redirect(`${path}?${kind}=${encodeURIComponent(text)}`);

async function owner() {
  const s = await getSession();
  if (!s) redirect("/auth/login?returnTo=/developer");
  if (!s.isOwner) go("/developer", "error", "開発者機能の操作は空間のオーナーのみ可能です。");
  return s;
}

export async function registerDeveloperAction(fd: FormData) {
  const s = await owner();
  if (await getDeveloper(s)) redirect("/developer");
  const name = str(fd, "name");
  const email = str(fd, "contactEmail");
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) go("/developer", "error", "提供会社名と連絡先メールアドレスを入力してください。");
  if (fd.get("agree") !== "on") go("/developer", "error", "開発者規約への同意が必要です。");
  const p = await prisma.provider.create({ data: { name, contactEmail: email, supportEmail: str(fd, "supportEmail") || email, websiteUrl: str(fd, "websiteUrl") || null, ownerTenantId: s.tenantId!, developerTermsVersion: "2026-11-01" } });
  await audit(prisma, { actorId: s.userId, actorType: "user", tenantId: s.tenantId, objectType: "provider", objectId: p.id, action: "developer_register" });
  go("/developer", "msg", "開発者登録が完了しました。アプリを作成して審査に提出できます。");
}

export async function updateProviderAction(fd: FormData) {
  const s = await owner();
  const p = await getDeveloper(s);
  if (!p) redirect("/developer");
  await prisma.provider.update({ where: { id: p.id }, data: { name: str(fd, "name") || p.name, contactEmail: str(fd, "contactEmail") || p.contactEmail, supportEmail: str(fd, "supportEmail") || null, websiteUrl: str(fd, "websiteUrl") || null } });
  await audit(prisma, { actorId: s.userId, actorType: "user", tenantId: s.tenantId, objectType: "provider", objectId: p.id, action: "developer_update" });
  go("/developer", "msg", "提供会社情報を更新しました（公開中アプリの表示にも反映されます）。");
}

export async function devCreateAppAction(fd: FormData) {
  const s = await owner();
  const p = await getDeveloper(s);
  if (!p) redirect("/developer");
  const slug = str(fd, "slug").toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) go("/developer/apps/new", "error", "slug は英小文字・数字・ハイフンで入力してください。");
  if (await prisma.app.findUnique({ where: { slug } })) go("/developer/apps/new", "error", "この slug は使用済みです。");
  const app = await prisma.app.create({ data: { slug, name: str(fd, "name") || slug, tagline: "", providerId: p.id, status: "draft" } });
  const d = draftFromApp({ ...app, categories: [], industries: [], integrationTags: [] }, []);
  d.supportChannels = p.supportEmail ? [{ type: "email", value: p.supportEmail }] : [];
  d.plans = [];
  await prisma.app.update({ where: { id: app.id }, data: { draft: d as unknown as Prisma.InputJsonValue } });
  await audit(prisma, { actorId: s.userId, actorType: "user", tenantId: s.tenantId, objectType: "app", objectId: app.id, action: "developer_create", toState: "draft" });
  go(`/developer/apps/${app.id}`, "msg", "下書きを作成しました。");
}

export async function devSaveDraftAction(fd: FormData) {
  const s = await owner();
  const id = str(fd, "id");
  const app = await developerApp(s, id);
  if (!app) go("/developer", "error", "アプリが見つかりません。");
  if (app!.reviewStatus === "submitted") go(`/developer/apps/${id}`, "error", "審査中は編集できません。先に提出を取り下げてください。");
  // 开发者不能自行设定接入 client ID（由运营发放）
  const d = draftFromForm(fd, { providerId: app!.providerId, launchClientId: app!.launchClientId });
  await prisma.app.update({ where: { id }, data: { draft: d as unknown as Prisma.InputJsonValue, reviewStatus: app!.reviewStatus === "rejected" ? "rejected" : app!.reviewStatus } });
  await audit(prisma, { actorId: s.userId, actorType: "user", tenantId: s.tenantId, objectType: "app", objectId: id, action: "developer_save_draft" });
  go(`/developer/apps/${id}`, "msg", "下書きを保存しました。");
}

export async function devSubmitAction(fd: FormData) {
  const s = await owner();
  const id = str(fd, "id");
  const app = await developerApp(s, id);
  if (!app) go("/developer", "error", "アプリが見つかりません。");
  const withdraw = str(fd, "op") === "withdraw";
  if (withdraw) {
    await prisma.app.updateMany({ where: { id, reviewStatus: "submitted" }, data: { reviewStatus: "none", submittedAt: null } });
    await audit(prisma, { actorId: s.userId, actorType: "user", tenantId: s.tenantId, objectType: "app", objectId: id, action: "developer_withdraw_submission" });
    go(`/developer/apps/${id}`, "msg", "審査への提出を取り下げました。");
  }
  if (!app!.draft) go(`/developer/apps/${id}`, "error", "提出する下書きがありません。");
  const current = await prisma.planVersion.count({ where: { appId: id, current: true } });
  const d = app!.draft as unknown as Parameters<typeof validateDraft>[0];
  const errors = validateDraft({ ...d, launchClientId: d.integrationType === "sso_integrated" ? d.launchClientId ?? "pending" : null }, current);
  if (errors.length) go(`/developer/apps/${id}`, "error", `提出に必要な項目が不足しています：${errors.join("、")}`);
  await prisma.app.update({ where: { id }, data: { reviewStatus: "submitted", submittedAt: new Date(), reviewNote: null } });
  await audit(prisma, { actorId: s.userId, actorType: "user", tenantId: s.tenantId, objectType: "app", objectId: id, action: "developer_submit" });
  go(`/developer/apps/${id}`, "msg", "審査に提出しました。運営が内容と接続テストを確認します。");
}

export async function devReplyAction(fd: FormData) {
  const s = await owner();
  const r = await prisma.review.findUnique({ where: { id: str(fd, "id") } });
  const app = r ? await developerApp(s, r.appId) : null;
  if (!r || !app) go("/developer", "error", "レビューが見つかりません。");
  const body = str(fd, "reply").slice(0, 1000);
  await prisma.review.update({ where: { id: r!.id }, data: { replyBody: body || null, repliedAt: body ? new Date() : null } });
  await audit(prisma, { actorId: s.userId, actorType: "user", tenantId: s.tenantId, objectType: "review", objectId: r!.id, action: "developer_reply" });
  go(`/developer/apps/${app!.id}`, "msg", "返信を保存しました。");
}
