"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { setUsageCap, addPaymentMethod, applyForApp, BizError, cancelPlanChange, cancelSubscription, changePlan, endTrialNow, payIntent, removePaymentMethod, setAutoRenew, undoCancel, withdrawApplication } from "@/lib/subscriptions";
import { submitReview } from "@/lib/reviews";
import { createMandate, revokeMandate } from "@/lib/agentpay";
import { visibleWhere } from "@/lib/notifications";
import { submitDeletion, withdrawDeletion } from "@/lib/deletion";
import { hit, limitIp, LIMITS } from "@/lib/ratelimit";
import { prisma } from "@/lib/db";
import { randomToken } from "@/lib/session";
import { getMessages } from "@/lib/messages";
import { bizErrorText } from "@/lib/biz-errors";

const fb = async () => (await getMessages()).ui.feedback;

export type FormState = { error?: string; code?: string; ok?: string } | undefined;

async function requireSession() {
  const s = await getSession();
  if (!s) redirect("/auth/login");
  return s;
}

export async function applyAction(_: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  if (!(await hit(`apply:user:${s.userId}`, LIMITS.apply)).ok) return { error: (await fb()).tooMany };
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
    if (e instanceof BizError) return { error: await bizErrorText(e), code: e.code };
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
    if (op === "withdraw") { await withdrawApplication(s, id); msg = (await fb()).withdrawn; }
    else if (op === "end_trial") { await endTrialNow(s, id); msg = (await fb()).trialEnded; }
    else if (op === "cancel") { await cancelSubscription(s, id); msg = (await fb()).canceled; }
    else if (op === "undo_cancel") { await undoCancel(s, id); msg = (await fb()).cancelUndone; }
  } catch (e) {
    if (e instanceof BizError) redirect(`/my/apps/${id}?error=${encodeURIComponent(await bizErrorText(e))}`);
    throw e;
  }
  revalidatePath("/my/apps");
  redirect(`/my/apps/${id}?msg=${encodeURIComponent(msg)}`);
}

export async function inquiryAction(_: FormState, fd: FormData): Promise<FormState> {
  const s = await getSession();
  const rl = await limitIp("contact", LIMITS.contact);
  if (!rl.ok) return { error: (await fb()).tooManySends(Math.ceil(rl.retryAfter / 60)) };
  const name = String(fd.get("name") ?? "").trim();
  const email = String(fd.get("email") ?? "").trim();
  const message = String(fd.get("message") ?? "").trim();
  const type = String(fd.get("type") ?? "other");
  if (!name || !email || !message) return { error: (await fb()).required };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: (await fb()).badEmail };
  if (message.length > 4000) return { error: (await fb()).tooLong };
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
  if (!(await hit(`pay:user:${s.userId}`, LIMITS.apply)).ok) return { error: (await fb()).tooMany };
  const intentId = String(fd.get("intentId"));
  const pmId = String(fd.get("paymentMethodId") ?? "");
  let subId: string;
  try {
    const sub = await payIntent(s, intentId, { paymentMethodId: pmId && pmId !== "new" ? pmId : undefined, card: pmId === "new" || !pmId ? cardFrom(fd) : undefined, autoRenew: fd.get("autoRenew") === "on" });
    subId = sub.id;
  } catch (e) {
    if (e instanceof BizError) return { error: await bizErrorText(e), code: e.code };
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
      target += `?msg=${encodeURIComponent((await fb()).changeCanceled)}`;
    } else {
      const r = await changePlan(s, id, String(fd.get("planVersionId")), Number(fd.get("expectedPriceJpy")), fd.get("payment") === "invoice" ? "invoice" : "card");
      if ("intentId" in r) target = `/pay/${r.intentId}`;
      else if ("scheduled" in r) target += `?msg=${encodeURIComponent((await fb()).changeScheduled)}`;
      else target += `?msg=${encodeURIComponent((await fb()).changeInvoice)}`;
    }
  } catch (e) {
    if (e instanceof BizError) redirect(`/my/apps/${id}?error=${encodeURIComponent(await bizErrorText(e))}`);
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
    if (e instanceof BizError) redirect(`/my/apps/${id}?error=${encodeURIComponent(await bizErrorText(e))}`);
    throw e;
  }
  redirect(`/my/apps/${id}?msg=${encodeURIComponent(fd.get("on") === "1" ? (await fb()).autoRenewOn : (await fb()).autoRenewOff)}`);
}

export async function addCardAction(_: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  try {
    const pm = await addPaymentMethod(s, cardFrom(fd));
    revalidatePath("/my/billing");
    return { ok: (await fb()).cardAdded(`${pm.brand} •••• ${pm.last4}`) };
  } catch (e) {
    if (e instanceof BizError) return { error: await bizErrorText(e) };
    throw e;
  }
}

export async function removeCardAction(fd: FormData) {
  const s = await requireSession();
  try {
    await removePaymentMethod(s, String(fd.get("id")));
  } catch (e) {
    if (e instanceof BizError) redirect(`/my/billing?error=${encodeURIComponent(await bizErrorText(e))}`);
    throw e;
  }
  redirect(`/my/billing?msg=${encodeURIComponent((await fb()).cardRemoved)}`);
}

export async function reviewAction(_: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  try {
    await submitReview(s, { appId: String(fd.get("appId")), rating: Number(fd.get("rating")), title: String(fd.get("title") ?? ""), body: String(fd.get("body") ?? "") });
  } catch (e) {
    if (e instanceof BizError) return { error: await bizErrorText(e) };
    throw e;
  }
  // 不对当前页 revalidatePath：详情页是动态渲染，刷新即得最新内容；同页重渲染曾使客户端 action 一直处于 pending（P1-7 偶发失败）。
  return { ok: (await fb()).reviewPosted };
}

export async function usageCapAction(fd: FormData) {
  const s = await requireSession();
  const id = String(fd.get("id"));
  const raw = String(fd.get("cap") ?? "").trim();
  try {
    await setUsageCap(s, id, raw === "" ? null : Math.floor(Number(raw)));
  } catch (e) {
    if (e instanceof BizError) redirect(`/my/apps/${id}?error=${encodeURIComponent(await bizErrorText(e))}`);
    throw e;
  }
  redirect(`/my/apps/${id}?msg=${encodeURIComponent(raw === "" ? (await fb()).capRemoved : (await fb()).capSet(Number(raw).toLocaleString()))}`);
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
    if (e instanceof BizError) return { error: await bizErrorText(e) };
    throw e;
  }
}

export async function revokeMandateAction(fd: FormData) {
  const s = await requireSession();
  await revokeMandate(s, String(fd.get("id")));
  revalidatePath("/my/agents");
  redirect(`/my/agents?msg=${encodeURIComponent((await fb()).mandateRevoked)}`);
}

export async function markNotificationsReadAction() {
  const s = await requireSession();
  const rows = await prisma.notification.findMany({ where: { ...visibleWhere(s), reads: { none: { userId: s.userId } } }, select: { id: true } });
  if (rows.length) await prisma.notificationRead.createMany({ data: rows.map((r) => ({ notificationId: r.id, userId: s.userId })), skipDuplicates: true });
  // 页头（根布局）的未读数也需要刷新
  revalidatePath("/", "layout");
  redirect("/my/notifications");
}

export async function submitDeletionAction(fd: FormData) {
  const s = await requireSession();
  if (fd.get("confirm") !== "on") redirect(`/account/deletion?error=${encodeURIComponent((await fb()).confirmFirst)}`);
  try {
    await submitDeletion(s, String(fd.get("reason") ?? ""));
  } catch (e) {
    if (e instanceof BizError) redirect(`/account/deletion?error=${encodeURIComponent(await bizErrorText(e))}`);
    throw e;
  }
  redirect(`/account/deletion?msg=${encodeURIComponent((await fb()).deletionReceived)}`);
}

export async function withdrawDeletionAction(fd: FormData) {
  const s = await requireSession();
  await withdrawDeletion(s, String(fd.get("id")));
  redirect(`/account/deletion?msg=${encodeURIComponent((await fb()).deletionWithdrawn)}`);
}
