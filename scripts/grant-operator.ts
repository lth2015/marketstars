// 授予/撤销 MarketStars 运营权限（OperatorGrant）。运营还必须在 OPERATOR_SSO_TENANT_ID 指定的运营空间登录。
// 用法：npx tsx scripts/grant-operator.ts <SSO user_id（32 位 hex）> [admin|operator] [--revoke]
import { PrismaClient } from "@prisma/client";

const [userId, role = "admin", flag] = process.argv.slice(2);
if (!userId || !/^[A-Za-z0-9_-]{8,64}$/.test(userId)) {
  console.error("usage: npx tsx scripts/grant-operator.ts <userId> [admin|operator] [--revoke]");
  process.exit(2);
}
const prisma = new PrismaClient();
(async () => {
  if (flag === "--revoke" || role === "--revoke") {
    await prisma.operatorGrant.updateMany({ where: { userId }, data: { active: false } });
    console.log(`revoked: ${userId}`);
  } else {
    await prisma.operatorGrant.upsert({ where: { userId }, create: { userId, role: role === "operator" ? "operator" : "admin", note: "granted via CLI" }, update: { active: true, role: role === "operator" ? "operator" : "admin" } });
    console.log(`granted ${role}: ${userId}`);
  }
  await prisma.auditEvent.create({ data: { actorId: "cli", actorType: "system", objectType: "operator_grant", objectId: userId, action: flag === "--revoke" || role === "--revoke" ? "revoke" : "grant" } });
})().finally(() => prisma.$disconnect());
