import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

type Tx = Prisma.TransactionClient | typeof prisma;

export async function audit(
  tx: Tx,
  e: {
    actorId: string;
    actorType: "user" | "operator" | "system";
    tenantId?: string | null;
    objectType: string;
    objectId: string;
    action: string;
    fromState?: string | null;
    toState?: string | null;
    reason?: string | null;
    data?: Prisma.InputJsonValue;
  },
) {
  await tx.auditEvent.create({ data: { ...e, tenantId: e.tenantId ?? null } });
}
