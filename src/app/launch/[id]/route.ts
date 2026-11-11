import { config } from "@/lib/config";
import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { getSession, randomToken } from "@/lib/session";
import { isEntitled } from "@/lib/subscriptions";
import { isSafeLaunchUrl } from "@/lib/text";
import { audit } from "@/lib/audit";

/**
 * 打开应用：后端校验当前身份、成员资格（getSession 内复查 SSO）和有效权益。
 * 已接入应用：签发 60 秒一次性启动码，应用服务端用自身 client secret 兑换并再次校验权益；
 * 不把 MarketStars access token 放进 URL。外部应用：仅跳转，并已在页面提示可能需另行登录。
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) return NextResponse.redirect(new URL(`/auth/login?returnTo=/my/apps`, config.baseUrl));
  const sub = await prisma.subscription.findFirst({ where: { id, tenantId: s.tenantId ?? "__none__" }, include: { app: true } });
  if (!sub || !isEntitled(sub) || sub.app.suspendedReason) return NextResponse.redirect(new URL(`/my/apps/${id}?error=${encodeURIComponent("現在このアプリを利用する権限がありません。")}`, config.baseUrl));
  const url = sub.app.launchUrl;
  if (!url || !isSafeLaunchUrl(url)) return NextResponse.redirect(new URL(`/my/apps/${id}?error=${encodeURIComponent("アプリの起動先が設定されていません。")}`, config.baseUrl));
  await audit(prisma, { actorId: s.userId, actorType: "user", tenantId: s.tenantId, objectType: "subscription", objectId: sub.id, action: "launch" });
  if (sub.app.integrationType !== "sso_integrated") return NextResponse.redirect(url);
  const code = randomToken(32);
  await prisma.launchTicket.create({ data: { codeHash: crypto.createHash("sha256").update(code).digest("hex"), appId: sub.appId, userId: s.userId, userName: s.userName, tenantId: s.tenantId!, expiresAt: new Date(Date.now() + 60000) } });
  const target = new URL(url);
  target.searchParams.set("ms_launch", code);
  return NextResponse.redirect(target);
}
