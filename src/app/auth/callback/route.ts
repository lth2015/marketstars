import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode, fetchIdentity, STATE_COOKIE, stateMatches } from "@/lib/sso";
import { createSession, destroySession } from "@/lib/session";
import { config } from "@/lib/config";
import { safeReturnTo } from "@/lib/text";
import { limitIp, LIMITS, tooMany } from "@/lib/ratelimit";
import { log } from "@/lib/log";

export async function GET(req: NextRequest) {
  const rl = await limitIp("authcb", LIMITS.authCallback, req);
  if (!rl.ok) return tooMany(rl.retryAfter);
  const p = req.nextUrl.searchParams;
  const state = p.get("state");
  const code = p.get("code");
  if (p.get("error") || !state || !code) {
    await log("WARNING", "auth.callback.failed", { reason: p.get("error") ?? "missing_params" });
    return NextResponse.redirect(`${config.baseUrl}/auth/login?error=callback`);
  }
  // このブラウザで始めたログインか確認（他人の state / code を送り付けられた場合は拒否）
  if (!stateMatches(req.cookies.get(STATE_COOKIE)?.value, state)) {
    await log("WARNING", "auth.callback.failed", { reason: "state_cookie_mismatch" });
    const res = NextResponse.redirect(`${config.baseUrl}/auth/login?error=callback`);
    res.cookies.delete({ name: STATE_COOKIE, path: "/auth" });
    return res;
  }
  try {
    const { tok, claims, returnTo } = await exchangeCode(state, code);
    const id = await fetchIdentity(tok.access_token);
    await destroySession();
    await createSession({
      userId: id.me.user_id,
      userName: String(claims.name ?? claims.preferred_username ?? claims.email ?? "利用者"),
      email: typeof claims.email === "string" ? claims.email : null,
      tenantId: id.tenant.id,
      tenantName: id.tenant.name,
      isOwner: id.tenant.owner,
      authMode: "oidc",
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token,
      idToken: tok.id_token,
      tokenExpiresAt: new Date(Date.now() + (tok.expires_in ?? 300) * 1000),
    });
    const res = NextResponse.redirect(config.baseUrl + safeReturnTo(returnTo));
    res.cookies.delete({ name: STATE_COOKIE, path: "/auth" });
    return res;
  } catch (e) {
    await log("ERROR", "auth.callback.failed", { error: String(e) });
    return NextResponse.redirect(`${config.baseUrl}/auth/login?error=callback`);
  }
}
