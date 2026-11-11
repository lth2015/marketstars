import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import type { SessionUser } from "./session";

export function visibleWhere(s: SessionUser): Prisma.NotificationWhereInput {
  return { tenantId: s.tenantId ?? "__none__", ...(s.isOwner ? {} : { ownerOnly: false }) };
}

export async function unreadCount(s: SessionUser | null) {
  if (!s?.tenantId) return 0;
  return prisma.notification.count({ where: { ...visibleWhere(s), reads: { none: { userId: s.userId } } } });
}
