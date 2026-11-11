// 公共 SSO（lth2015/sso）适配：OIDC code + S256 PKCE（经 Hydra），服务端调用 /v1/me、/v1/tenants。
import * as jose from "jose";
import crypto from "node:crypto";
import type { Session } from "@prisma/client";
import { prisma } from "./db";
import { config } from "./config";

type Discovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  revocation_endpoint?: string;
  end_session_endpoint?: string;
};

let discoveryCache: { at: number; d: Discovery } | null = null;
export async function discovery(opts: { fresh?: boolean } = {}): Promise<Discovery> {
  if (!opts.fresh && discoveryCache && Date.now() - discoveryCache.at < 10 * 60 * 1000) return discoveryCache.d;
  const url = config.oidc.issuer.replace(/\/$/, "") + "/.well-known/openid-configuration";
  const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`discovery ${r.status}`);
  const d = (await r.json()) as Discovery;
  discoveryCache = { at: Date.now(), d };
  return d;
}

export function pkcePair() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export async function buildAuthorizeUrl(returnTo: string, opts: { forceConsent?: boolean } = {}) {
  // 发起登录时总是重新获取发现文档：SSO 不可用时在 MarketStars 侧显示重试提示，而不是把用户送到错误页
  const d = await discovery({ fresh: true });
  const state = crypto.randomBytes(24).toString("base64url");
  const nonce = crypto.randomBytes(24).toString("base64url");
  const { verifier, challenge } = pkcePair();
  await prisma.authState.create({ data: { id: state, verifier, nonce, returnTo } });
  const u = new URL(d.authorization_endpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", config.oidc.clientId);
  u.searchParams.set("redirect_uri", config.oidc.redirectUri);
  u.searchParams.set("scope", config.oidc.scopes);
  u.searchParams.set("state", state);
  u.searchParams.set("nonce", nonce);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  if (config.oidc.audience) u.searchParams.set("audience", config.oidc.audience);
  // 切换空间：重新走该空间授权（SSO 同意页逐次选择租户）
  if (opts.forceConsent) u.searchParams.set("prompt", "consent");
  return u.toString();
}

async function tokenRequest(body: Record<string, string>) {
  const d = await discovery();
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  const params = new URLSearchParams(body);
  if (config.oidc.clientSecret) {
    headers.authorization =
      "Basic " + Buffer.from(`${encodeURIComponent(config.oidc.clientId)}:${encodeURIComponent(config.oidc.clientSecret)}`).toString("base64");
  } else {
    params.set("client_id", config.oidc.clientId);
  }
  const r = await fetch(d.token_endpoint, { method: "POST", headers, body: params, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`token ${r.status}`);
  return (await r.json()) as { access_token: string; refresh_token?: string; id_token?: string; expires_in?: number };
}

export async function exchangeCode(state: string, code: string) {
  const st = await prisma.authState.findUnique({ where: { id: state } });
  if (!st) throw new Error("state_unknown");
  await prisma.authState.delete({ where: { id: state } });
  if (Date.now() - st.createdAt.getTime() > 10 * 60 * 1000) throw new Error("state_expired");
  const tok = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.oidc.redirectUri,
    code_verifier: st.verifier,
  });
  if (!tok.id_token) throw new Error("no_id_token");
  const d = await discovery();
  const jwks = jose.createRemoteJWKSet(new URL(d.jwks_uri));
  // ID token 仅用于身份确认，业务调用使用为平台 API 签发的 access token。
  const { payload } = await jose.jwtVerify(tok.id_token, jwks, { issuer: d.issuer, audience: config.oidc.clientId });
  if (payload.nonce !== st.nonce) throw new Error("nonce_mismatch");
  return { tok, claims: payload, returnTo: st.returnTo };
}

async function api<T>(path: string, accessToken: string): Promise<{ status: number; body?: T }> {
  const r = await fetch(config.sso.apiBase + path, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) return { status: r.status };
  return { status: r.status, body: (await r.json()) as T };
}

export type SsoMe = { user_id: string; tenant_id: string; membership_id: string; session_id: string };
export type SsoTenant = { id: string; name: string; slug: string; owner: boolean };

export async function fetchIdentity(accessToken: string) {
  const me = await api<SsoMe>("/v1/me", accessToken);
  if (!me.body) throw new Error(`me_${me.status}`);
  const tenants = await api<{ items: SsoTenant[] }>("/v1/tenants?limit=100", accessToken);
  const current = tenants.body?.items?.find((t) => t.id === me.body!.tenant_id);
  if (!current) throw new Error("tenant_not_listed");
  return { me: me.body, tenant: current, tenants: tenants.body?.items ?? [] };
}

/** 复查当前会话资格；失败（401/403、成员停用、grant 失效）返回 false。 */
export async function reverifySession(s: Session): Promise<boolean> {
  try {
    let accessToken = s.accessToken ?? "";
    if (s.tokenExpiresAt && s.tokenExpiresAt.getTime() < Date.now() + 30000) {
      const fresh = await refreshSerialized(s.id);
      if (!fresh) return false;
      accessToken = fresh;
    }
    const id = await fetchIdentity(accessToken);
    if (id.me.user_id !== s.userId || id.me.tenant_id !== s.tenantId) return false;
    await prisma.session.update({ where: { id: s.id }, data: { lastVerifiedAt: new Date(), isOwner: id.tenant.owner, tenantName: id.tenant.name } });
    return true;
  } catch {
    return false;
  }
}

/**
 * 串行刷新：SSO 会轮换 refresh token，同一会话的并发请求（多个组件、多副本）若各自刷新，
 * 第二个会因旧 refresh token 失效而失败。这里锁住会话行，拿到锁后先重读，已被别的请求刷新则直接使用。
 */
async function refreshSerialized(sessionId: string): Promise<string | null> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM Session WHERE id = ${sessionId} FOR UPDATE`;
      const cur = await tx.session.findUnique({ where: { id: sessionId } });
      if (!cur?.refreshToken) return null;
      if (cur.accessToken && cur.tokenExpiresAt && cur.tokenExpiresAt.getTime() >= Date.now() + 30000) return cur.accessToken;
      const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: cur.refreshToken });
      await tx.session.update({
        where: { id: sessionId },
        data: { accessToken: t.access_token, refreshToken: t.refresh_token ?? cur.refreshToken, tokenExpiresAt: new Date(Date.now() + (t.expires_in ?? 300) * 1000) },
      });
      return t.access_token;
    },
    { timeout: 15000, maxWait: 15000 },
  ).catch(() => null);
}

export async function revokeTokens(s: Pick<Session, "refreshToken" | "accessToken">) {
  try {
    const d = await discovery();
    if (!d.revocation_endpoint) return;
    for (const token of [s.refreshToken, s.accessToken]) {
      if (!token) continue;
      const params = new URLSearchParams({ token });
      const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
      if (config.oidc.clientSecret) {
        headers.authorization = "Basic " + Buffer.from(`${config.oidc.clientId}:${config.oidc.clientSecret}`).toString("base64");
      } else params.set("client_id", config.oidc.clientId);
      await fetch(d.revocation_endpoint, { method: "POST", headers, body: params, signal: AbortSignal.timeout(5000) });
    }
  } catch {
    /* 撤销失败不阻断本地退出 */
  }
}
