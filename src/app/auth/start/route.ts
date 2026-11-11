import { NextResponse, type NextRequest } from "next/server";
import { buildAuthorizeUrl } from "@/lib/sso";
import { config } from "@/lib/config";
import { safeReturnTo } from "@/lib/text";

export async function GET(req: NextRequest) {
  const returnTo = safeReturnTo(req.nextUrl.searchParams.get("returnTo"));
  if (config.authMode !== "oidc") return NextResponse.redirect(`${config.baseUrl}/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  try {
    const url = await buildAuthorizeUrl(returnTo, { forceConsent: req.nextUrl.searchParams.get("switch") === "1" });
    return NextResponse.redirect(url);
  } catch (e) {
    console.error(JSON.stringify({ severity: "ERROR", message: "auth.start.failed", error: String(e) }));
    return NextResponse.redirect(`${config.baseUrl}/auth/login?error=sso_unavailable&returnTo=${encodeURIComponent(returnTo)}`);
  }
}
