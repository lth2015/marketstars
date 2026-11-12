import { prisma } from "./db";
import { audit } from "./audit";
import { BizError } from "./subscriptions";
import type { SessionUser } from "./session";
import { emitEvent } from "./events";

/** 实际利用过（试用/免费/付费开通过，不含仅申请）的空间成员才可评价。 */
export async function canReview(s: SessionUser | null, appId: string) {
  if (!s?.tenantId) return false;
  // 提供会社自身の空間と社内テストの利用は対象外（自作自演の評価を防ぐ）
  const app = await prisma.app.findUnique({ where: { id: appId }, select: { provider: { select: { ownerTenantId: true } } } });
  if (!app || app.provider.ownerTenantId === s.tenantId) return false;
  const used = await prisma.subscription.count({ where: { tenantId: s.tenantId, appId, internalTest: false, startedAt: { not: null }, status: { notIn: ["pending", "rejected", "withdrawn"] } } });
  return used > 0;
}

export async function recomputeRating(appId: string) {
  const agg = await prisma.review.aggregate({ where: { appId, status: "published" }, _avg: { rating: true }, _count: true });
  await prisma.app.update({ where: { id: appId }, data: { ratingAvg: agg._count ? Math.round((agg._avg.rating ?? 0) * 10) / 10 : null, ratingCount: agg._count } });
}

export async function submitReview(s: SessionUser, r: { appId: string; rating: number; title: string; body: string }) {
  if (!(await canReview(s, r.appId))) throw new BizError("not_eligible", "この空間で利用したことのあるアプリのみレビューできます。");
  const rating = Math.round(r.rating);
  if (!(rating >= 1 && rating <= 5)) throw new BizError("rating", "評価は1〜5で選択してください。");
  const title = r.title.trim().slice(0, 80);
  const body = r.body.trim().slice(0, 2000);
  if (!title || body.length < 10) throw new BizError("body", "タイトルと10文字以上の本文を入力してください。");
  const row = await prisma.review.upsert({
    where: { appId_userId: { appId: r.appId, userId: s.userId } },
    create: { appId: r.appId, tenantId: s.tenantId!, tenantName: s.tenantName ?? "", userId: s.userId, userName: s.userName, rating, title, body },
    update: { rating, title, body, tenantId: s.tenantId!, tenantName: s.tenantName ?? "" },
  });
  await audit(prisma, { actorId: s.userId, actorType: "user", tenantId: s.tenantId, objectType: "review", objectId: row.id, action: "upsert", data: { rating } });
  const app = await prisma.app.findUniqueOrThrow({ where: { id: r.appId }, include: { provider: true } });
  if (app.provider.ownerTenantId) await emitEvent(prisma, { type: "review.created", tenantId: app.provider.ownerTenantId, appId: app.id, payload: { appName: app.name, appId: app.id, rating, reviewTitle: title }, dedupeKey: `review:${row.id}:${row.updatedAt.getTime()}` });
  await recomputeRating(r.appId);
}

export function maskName(name: string) {
  return name ? `${[...name][0]}***` : "利用者";
}
