import { NextResponse, type NextRequest } from "next/server";
import { config } from "@/lib/config";
import { destroySession } from "@/lib/session";
import { revokeTokens } from "@/lib/sso";

/** 退出当前应用：清理服务端会话并撤销本应用授权；global=1 时转到 SSO 全设备退出确认页。 */
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(config.baseUrl).origin && origin !== req.nextUrl.origin) return new NextResponse("Forbidden", { status: 403 });
  const fd = await req.formData();
  const s = await destroySession();
  if (s?.authMode === "oidc") await revokeTokens(s);
  if (fd.get("global") === "1" && config.sso.logoutUrl) return NextResponse.redirect(config.sso.logoutUrl, 303);
  return NextResponse.redirect(new URL("/?logged_out=1", req.url), 303);
}
