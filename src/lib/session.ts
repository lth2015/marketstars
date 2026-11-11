import { cookies } from "next/headers";
import crypto from "node:crypto";
import { prisma } from "./db";
import { config } from "./config";
import { reverifySession } from "./sso";

export const SESSION_COOKIE = "ms_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const REVERIFY_MS = 60 * 1000;

export type SessionUser = {
  sessionId: string;
  userId: string;
  userName: string;
  email: string | null;
  tenantId: string | null;
  tenantName: string | null;
  isOwner: boolean;
  csrfToken: string;
  authMode: string;
};

export function hashId(id: string) {
  return crypto.createHmac("sha256", config.sessionSecret).update(id).digest("hex");
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export async function createSession(data: {
  userId: string;
  userName: string;
  email?: string | null;
  tenantId: string | null;
  tenantName: string | null;
  isOwner: boolean;
  authMode: "oidc" | "demo";
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  tokenExpiresAt?: Date;
}) {
  const raw = randomToken();
  await prisma.session.create({
    data: {
      id: hashId(raw),
      ...data,
      email: data.email ?? null,
      csrfToken: randomToken(24),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, raw, {
    httpOnly: true,
    secure: config.baseUrl.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (raw) {
    const s = await prisma.session.findUnique({ where: { id: hashId(raw) } });
    await prisma.session.deleteMany({ where: { id: hashId(raw) } });
    jar.delete(SESSION_COOKIE);
    return s;
  }
  return null;
}

/** 读取当前会话；OIDC 模式下定期向 SSO 复查资格（成员停用、安全版本变化后旧会话失效）。 */
export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  let s = await prisma.session.findUnique({ where: { id: hashId(raw) } });
  if (!s) return null;
  if (s.expiresAt < new Date()) {
    await prisma.session.deleteMany({ where: { id: s.id } });
    return null;
  }
  if (s.authMode === "oidc" && Date.now() - s.lastVerifiedAt.getTime() > REVERIFY_MS) {
    const ok = await reverifySession(s);
    if (!ok) {
      await prisma.session.deleteMany({ where: { id: s.id } });
      return null;
    }
    s = (await prisma.session.findUnique({ where: { id: s.id } }))!;
  }
  return {
    sessionId: s.id,
    userId: s.userId,
    userName: s.userName,
    email: s.email,
    tenantId: s.tenantId,
    tenantName: s.tenantName,
    isOwner: s.isOwner,
    csrfToken: s.csrfToken,
    authMode: s.authMode,
  };
}

export async function isOperator(s: SessionUser | null): Promise<{ role: string } | null> {
  if (!s || !s.tenantId) return null;
  if (!config.operatorTenantId || s.tenantId !== config.operatorTenantId) return null;
  const g = await prisma.operatorGrant.findUnique({ where: { userId: s.userId } });
  return g && g.active ? { role: g.role } : null;
}
