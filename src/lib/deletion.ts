// 账号注销申请：检查 MarketStars 侧的前提条件，受理并转交 SSO。本地不删除身份、空间或交易记录。
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { audit } from "./audit";
import { BizError } from "./subscriptions";
import type { SessionUser } from "./session";

export type Check = { key: string; ok: boolean; blocking: boolean; title: string; detail: string; link?: string };

export async function deletionChecks(s: SessionUser): Promise<Check[]> {
  const tenantId = s.tenantId ?? "__none__";
  const [live, due, mandates, provider] = await Promise.all([
    prisma.subscription.findMany({ where: { tenantId, liveKey: { not: null }, kind: { in: ["paid", "trial", "free"] } }, include: { app: { select: { name: true } } } }),
    prisma.billingRecord.findMany({ where: { tenantId, status: "due" }, include: { subscription: { include: { app: { select: { name: true } } } } } }),
    prisma.agentMandate.count({ where: { tenantId, createdBy: s.userId, revokedAt: null, expiresAt: { gt: new Date() } } }),
    prisma.provider.findUnique({ where: { ownerTenantId: tenantId } }),
  ]);
  const paidLive = live.filter((x) => x.kind === "paid" && x.status !== "cancel_scheduled");
  return [
    { key: "subscriptions", ok: !(s.isOwner && paidLive.length), blocking: true, title: "利用中の有料契約", detail: paidLive.length && s.isOwner ? `解約が必要です：${paidLive.map((x) => x.app.name).join("、")}（期間終了時の解約手続きで構いません）` : "対応が必要な有料契約はありません。", link: "/my/apps" },
    { key: "bills", ok: !due.length, blocking: true, title: "未払いの請求", detail: due.length ? `精算が必要です：${due.map((b) => `${b.subscription.app.name} ¥${b.amountJpy.toLocaleString()}`).join("、")}` : "未払いの請求はありません。", link: "/my/billing" },
    { key: "agents", ok: !mandates, blocking: true, title: "AIエージェントの支払い権限", detail: mandates ? `あなたが発行した有効な権限が ${mandates} 件あります。取り消してください。` : "有効な権限はありません。", link: "/my/agents" },
    { key: "provider", ok: !provider, blocking: false, title: "アプリ提供会社としての登録", detail: provider ? `空間「${s.tenantName}」は提供会社「${provider.name}」として登録されています。公開中のアプリの引き継ぎについて運営から連絡します。` : "提供会社の登録はありません。", link: "/developer" },
    { key: "owner", ok: true, blocking: false, title: "空間の最後のオーナー（共通 SSO で確認）", detail: "最後のオーナーである空間は、削除の前に共通アカウントの管理画面でオーナーを移管するか、空間を閉じる必要があります。MarketStars からは判定できないため、SSO 側で確認されます。" },
    { key: "free", ok: true, blocking: false, title: "無料・体験中のアプリ", detail: live.filter((x) => x.kind !== "paid").length ? "無料・体験中のアプリは、アカウント削除にあわせて利用を終了します。" : "該当はありません。" },
  ];
}

export async function currentRequest(userId: string) {
  return prisma.deletionRequest.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
}

export async function submitDeletion(s: SessionUser, reason: string) {
  const checks = await deletionChecks(s);
  const blocking = checks.filter((c) => c.blocking && !c.ok);
  if (blocking.length) throw new BizError("blocked", `先に対応が必要な項目があります：${blocking.map((c) => c.title).join("、")}`);
  try {
    const r = await prisma.deletionRequest.create({ data: { userId: s.userId, userName: s.userName, email: s.email, tenantId: s.tenantId, tenantName: s.tenantName, openKey: s.userId, checks: checks as unknown as Prisma.InputJsonValue, reason: reason.slice(0, 2000) || null } });
    await audit(prisma, { actorId: s.userId, actorType: "user", tenantId: s.tenantId, objectType: "deletion_request", objectId: r.id, action: "submit", toState: "submitted" });
    return r;
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new BizError("exists", "受付中の申請があります。");
    throw e;
  }
}

export async function withdrawDeletion(s: SessionUser, id: string) {
  const r = await prisma.deletionRequest.updateMany({ where: { id, userId: s.userId, status: { in: ["submitted", "in_review"] } }, data: { status: "closed", openKey: null, operatorNote: "利用者が取り下げ" } });
  if (r.count) await audit(prisma, { actorId: s.userId, actorType: "user", tenantId: s.tenantId, objectType: "deletion_request", objectId: id, action: "withdraw", toState: "closed" });
}

const NEXT: Record<string, string[]> = { submitted: ["in_review", "rejected"], in_review: ["forwarded_to_sso", "rejected"], forwarded_to_sso: ["closed"] };

export async function operatorUpdateDeletion(op: { userId: string }, id: string, to: string, note: string, ssoTicketRef?: string) {
  const r = await prisma.deletionRequest.findUniqueOrThrow({ where: { id } });
  if (!NEXT[r.status]?.includes(to)) throw new BizError("state", "この状態には変更できません。");
  if (to === "rejected" && !note) throw new BizError("note", "却下の理由を入力してください。");
  if (to === "forwarded_to_sso" && !ssoTicketRef) throw new BizError("ticket", "SSO 側の受付番号を入力してください。");
  const ended = to === "closed" || to === "rejected";
  const u = await prisma.deletionRequest.updateMany({ where: { id, status: r.status }, data: { status: to, operatorNote: note || r.operatorNote, ssoTicketRef: ssoTicketRef ?? r.ssoTicketRef, handledBy: op.userId, ...(ended ? { openKey: null } : {}) } });
  if (!u.count) throw new BizError("state", "状態が変更されています。");
  await audit(prisma, { actorId: op.userId, actorType: "operator", tenantId: r.tenantId, objectType: "deletion_request", objectId: id, action: to, fromState: r.status, toState: to, reason: note || null });
}

export const DELETION_STATUS: Record<string, string> = { submitted: "受付済み", in_review: "確認中", forwarded_to_sso: "共通アカウント（SSO）で処理中", closed: "完了／終了", rejected: "お受けできませんでした" };
