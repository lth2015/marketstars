import { prisma } from "./db";
import type { SessionUser } from "./session";

/** 开发者身份 = 当前 SSO 空间拥有的 Provider（空间成员均可查看，编辑与提交限 owner）。 */
export async function getDeveloper(s: SessionUser | null) {
  if (!s?.tenantId) return null;
  return prisma.provider.findUnique({ where: { ownerTenantId: s.tenantId } });
}

export async function developerApp(s: SessionUser | null, appId: string) {
  const p = await getDeveloper(s);
  if (!p) return null;
  return prisma.app.findFirst({ where: { id: appId, providerId: p.id } });
}
