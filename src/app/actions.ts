"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { setUsageCap, addPaymentMethod, applyForApp, BizError, cancelPlanChange, cancelSubscription, changePlan, endTrialNow, payIntent, removePaymentMethod, setAutoRenew, undoCancel, withdrawApplication } from "@/lib/subscriptions";
import { submitReview } from "@/lib/reviews";
import { createMandate, revokeMandate } from "@/lib/agentpay";
import { visibleWhere } from "@/lib/notifications";
import { hit, limitIp, LIMITS } from "@/lib/ratelimit";
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
  if (!(await hit(`apply:user:${s.userId}`, LIMITS.apply)).ok) return { error: "操作が多すぎます。しばらくしてから再度お試しください。" };
  let subId: string;
  let intentId: string | null = null;
  try {
    const sub = await applyForApp(s, {
      appId: String(fd.get("appId")),
      planVersionId: String(fd.get("planVersionId")),
      expectedPriceJpy: Number(fd.get("expectedPriceJpy")),
      mode: fd.get("mode") === "trial" ? "trial" : "start",
      idempotencyKey: String(fd.get("idempotencyKey")),
      agreed: fd.get("agreePlatform") === "on" && fd.get("agreeProvider") === "on",
      contactNote: String(fd.get("contactNote") ?? ""),
      payment: fd.get("payment") === "card" ? "card" : "invoice",
    });
    subId = sub.id;
    intentId = sub.intentId;
  } catch (e) {
    if (e instanceof BizError) return { error: e.message, code: e.code };
    throw e;
  }
  revalidatePath("/my/apps");
  if (intentId) redirect(`/pay/${intentId}`);
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
  const rl = await limitIp("contact", LIMITS.contact);
  if (!rl.ok) return { error: `送信回数が多すぎます。${Math.ceil(rl.retryAfter / 60)} 分ほど待ってから再度お試しください。` };
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

const cardFrom = (fd: FormData) => {
  const exp = String(fd.get("exp") ?? "").split("/").map((x) => Number(x.trim()));
  return { number: String(fd.get("cardNumber") ?? ""), expMonth: exp[0] ?? 0, expYear: exp[1] ?? 0, cvc: String(fd.get("cvc") ?? "").trim() };
};

export async function payAction(_: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  if (!(await hit(`pay:user:${s.userId}`, LIMITS.apply)).ok) return { error: "操作が多すぎます。しばらくしてから再度お試しください。" };
  const intentId = String(fd.get("intentId"));
  const pmId = String(fd.get("paymentMethodId") ?? "");
  let subId: string;
  try {
    const sub = await payIntent(s, intentId, { paymentMethodId: pmId && pmId !== "new" ? pmId : undefined, card: pmId === "new" || !pmId ? cardFrom(fd) : undefined, autoRenew: fd.get("autoRenew") === "on" });
    subId = sub.id;
  } catch (e) {
    if (e instanceof BizError) return { error: e.message, code: e.code };
    throw e;
  }
  revalidatePath("/my/apps");
  redirect(`/my/apps/${subId}?paid=1`);
}

export async function planChangeAction(fd: FormData) {
  const s = await requireSession();
  const id = String(fd.get("id"));
  let target = `/my/apps/${id}`;
  try {
    if (fd.get("op") === "cancel_change") {
      await cancelPlanChange(s, id);
      target += `?msg=${encodeURIComponent("プラン変更の予定を取り消しました。")}`;
    } else {
      const r = await changePlan(s, id, String(fd.get("planVersionId")), Number(fd.get("expectedPriceJpy")), fd.get("payment") === "invoice" ? "invoice" : "card");
      if ("intentId" in r) target = `/pay/${r.intentId}`;
      else if ("scheduled" in r) target += `?msg=${encodeURIComponent("現在の利用期間の終了時にプランを変更します。")}`;
      else target += `?msg=${encodeURIComponent("有料プランへの切り替えを受け付けました。運営の入金確認後に切り替わります（無料体験期間内に確認が必要です）。")}`;
    }
  } catch (e) {
    if (e instanceof BizError) redirect(`/my/apps/${id}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath("/my/apps");
  redirect(target);
}

export async function autoRenewAction(fd: FormData) {
  const s = await requireSession();
  const id = String(fd.get("id"));
  try {
    await setAutoRenew(s, id, fd.get("on") === "1", String(fd.get("paymentMethodId") ?? "") || undefined);
  } catch (e) {
    if (e instanceof BizError) redirect(`/my/apps/${id}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/my/apps/${id}?msg=${encodeURIComponent(fd.get("on") === "1" ? "自動更新を設定しました。" : "自動更新を停止しました。期間終了後は入金確認がない限り終了します。")}`);
}

export async function addCardAction(_: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  try {
    const pm = await addPaymentMethod(s, cardFrom(fd));
    revalidatePath("/my/billing");
    return { ok: `${pm.brand} •••• ${pm.last4} を登録しました。` };
  } catch (e) {
    if (e instanceof BizError) return { error: e.message };
    throw e;
  }
}

export async function removeCardAction(fd: FormData) {
  const s = await requireSession();
  try {
    await removePaymentMethod(s, String(fd.get("id")));
  } catch (e) {
    if (e instanceof BizError) redirect(`/my/billing?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/my/billing?msg=${encodeURIComponent("カードを削除しました。")}`);
}

export async function reviewAction(_: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  try {
    await submitReview(s, { appId: String(fd.get("appId")), rating: Number(fd.get("rating")), title: String(fd.get("title") ?? ""), body: String(fd.get("body") ?? "") });
  } catch (e) {
    if (e instanceof BizError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/apps/${String(fd.get("slug"))}`);
  return { ok: "レビューを投稿しました。" };
}

export async function usageCapAction(fd: FormData) {
  const s = await requireSession();
  const id = String(fd.get("id"));
  const raw = String(fd.get("cap") ?? "").trim();
  try {
    await setUsageCap(s, id, raw === "" ? null : Math.floor(Number(raw)));
  } catch (e) {
    if (e instanceof BizError) redirect(`/my/apps/${id}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/my/apps/${id}?msg=${encodeURIComponent(raw === "" ? "利用上限を解除しました。" : `月の利用上限を ¥${Number(raw).toLocaleString()} に設定しました。`)}`);
}

export async function createMandateAction(_: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  try {
    const { key } = await createMandate(s, {
      name: String(fd.get("name") ?? ""),
      monthlyBudgetJpy: Math.floor(Number(fd.get("budget"))),
      perTxLimitJpy: Math.floor(Number(fd.get("perTx"))),
      allowedAppIds: fd.get("allApps") === "on" ? null : fd.getAll("apps").map(String),
      days: Math.floor(Number(fd.get("days"))),
      scopes: fd.getAll("scopes").map(String),
    });
    revalidatePath("/my/agents");
    return { ok: key };
  } catch (e) {
    if (e instanceof BizError) return { error: e.message };
    throw e;
  }
}

export async function revokeMandateAction(fd: FormData) {
  const s = await requireSession();
  await revokeMandate(s, String(fd.get("id")));
  revalidatePath("/my/agents");
  redirect(`/my/agents?msg=${encodeURIComponent("権限を取り消しました。このキーは直ちに使えなくなります。")}`);
}

export async function markNotificationsReadAction() {
  const s = await requireSession();
  const rows = await prisma.notification.findMany({ where: { ...visibleWhere(s), reads: { none: { userId: s.userId } } }, select: { id: true } });
  if (rows.length) await prisma.notificationRead.createMany({ data: rows.map((r) => ({ notificationId: r.id, userId: s.userId })), skipDuplicates: true });
  // 页头（根布局）的未读数也需要刷新
  revalidatePath("/", "layout");
  redirect("/my/notifications");
}
