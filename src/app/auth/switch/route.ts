import { NextResponse, type NextRequest } from "next/server";
import { config } from "@/lib/config";
import { safeReturnTo } from "@/lib/text";

/** 切换空间：重新走该空间授权，不能只替换 tenant_id。 */
export async function GET(req: NextRequest) {
  const returnTo = safeReturnTo(req.nextUrl.searchParams.get("returnTo"));
  if (config.authMode === "oidc") return NextResponse.redirect(new URL(`/auth/start?switch=1&returnTo=${encodeURIComponent(returnTo)}`, req.url));
  return NextResponse.redirect(new URL(`/auth/login?switch=1&returnTo=${encodeURIComponent(returnTo)}`, req.url));
}
