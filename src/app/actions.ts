"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { applyForApp, BizError, cancelSubscription, endTrialNow, undoCancel, withdrawApplication } from "@/lib/subscriptions";
import { prisma } from "@/lib/db";
import { randomToken } from "@/lib/session";

export type FormState = { error?: string; code?: string; ok?: string } | undefined;

async function requireSession() {
  const s = await getSession();
  if (!s) redirect("/auth/login");
  return s;
}

export async function applyAction(_: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  let subId: string;
  try {
    const sub = await applyForApp(s, {
      appId: String(fd.get("appId")),
      planVersionId: String(fd.get("planVersionId")),
      expectedPriceJpy: Number(fd.get("expectedPriceJpy")),
      mode: fd.get("mode") === "trial" ? "trial" : "start",
      idempotencyKey: String(fd.get("idempotencyKey")),
      agreed: fd.get("agreePlatform") === "on" && fd.get("agreeProvider") === "on",
      contactNote: String(fd.get("contactNote") ?? ""),
    });
    subId = sub.id;
  } catch (e) {
    if (e instanceof BizError) return { error: e.message, code: e.code };
    throw e;
  }
  revalidatePath("/my/apps");
  redirect(`/my/apps/${subId}?done=1`);
}

export async function subscriptionAction(fd: FormData) {
  const s = await requireSession();
  const id = String(fd.get("id"));
  const op = String(fd.get("op"));
  let msg = "";
  try {
    if (op === "withdraw") { await withdrawApplication(s, id); msg = "お申し込みを取り下げました。"; }
    else if (op === "end_trial") { await endTrialNow(s, id); msg = "無料体験を終了しました。"; }
    else if (op === "cancel") { await cancelSubscription(s, id); msg = "解約を受け付けました。"; }
    else if (op === "undo_cancel") { await undoCancel(s, id); msg = "解約を取り消しました。"; }
  } catch (e) {
    if (e instanceof BizError) redirect(`/my/apps/${id}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath("/my/apps");
  redirect(`/my/apps/${id}?msg=${encodeURIComponent(msg)}`);
}

export async function inquiryAction(_: FormState, fd: FormData): Promise<FormState> {
  const s = await getSession();
  const name = String(fd.get("name") ?? "").trim();
  const email = String(fd.get("email") ?? "").trim();
  const message = String(fd.get("message") ?? "").trim();
  const type = String(fd.get("type") ?? "other");
  if (!name || !email || !message) return { error: "必須項目を入力してください。" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "メールアドレスの形式が正しくありません。" };
  if (message.length > 4000) return { error: "お問い合わせ内容は4,000文字以内で入力してください。" };
  const slug = String(fd.get("app") ?? "");
  const app = slug ? await prisma.app.findUnique({ where: { slug } }) : null;
  const d = new Date();
  const publicNo = `MS-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${randomToken(4).replace(/[^A-Za-z0-9]/g, "").slice(0, 5).toUpperCase()}`;
  await prisma.inquiry.create({ data: { publicNo, appId: app?.id ?? null, type, name, email, company: String(fd.get("company") ?? "") || null, message, tenantId: s?.tenantId ?? null, userId: s?.userId ?? null } });
  return { ok: publicNo };
}
