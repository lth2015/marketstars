import { NextResponse, type NextRequest } from "next/server";
import { buildAuthorizeUrl } from "@/lib/sso";
import { config } from "@/lib/config";
import { safeReturnTo } from "@/lib/text";
import { limitIp, LIMITS, tooMany } from "@/lib/ratelimit";
import { log } from "@/lib/log";

export async function GET(req: NextRequest) {
  const returnTo = safeReturnTo(req.nextUrl.searchParams.get("returnTo"));
  const rl = await limitIp("auth", LIMITS.authStart, req);
  if (!rl.ok) return tooMany(rl.retryAfter);
  if (config.authMode !== "oidc") return NextResponse.redirect(`${config.baseUrl}/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  try {
    const url = await buildAuthorizeUrl(returnTo, { forceConsent: req.nextUrl.searchParams.get("switch") === "1" });
    return NextResponse.redirect(url);
  } catch (e) {
    await log("ERROR", "auth.start.failed", { error: String(e) });
    return NextResponse.redirect(`${config.baseUrl}/auth/login?error=sso_unavailable&returnTo=${encodeURIComponent(returnTo)}`);
  }
}
