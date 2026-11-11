import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode, fetchIdentity } from "@/lib/sso";
import { createSession, destroySession } from "@/lib/session";
import { config } from "@/lib/config";
import { safeReturnTo } from "@/lib/text";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const state = p.get("state");
  const code = p.get("code");
  if (p.get("error") || !state || !code) {
    console.error(JSON.stringify({ severity: "WARNING", message: "auth.callback.failed", reason: p.get("error") ?? "missing_params" }));
    return NextResponse.redirect(`${config.baseUrl}/auth/login?error=callback`);
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
    return NextResponse.redirect(config.baseUrl + safeReturnTo(returnTo));
  } catch (e) {
    console.error(JSON.stringify({ severity: "ERROR", message: "auth.callback.failed", error: String(e) }));
    return NextResponse.redirect(`${config.baseUrl}/auth/login?error=callback`);
  }
}
