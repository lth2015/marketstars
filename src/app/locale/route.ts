import { NextResponse, type NextRequest } from "next/server";
import { config } from "@/lib/config";
import { LOCALE_COOKIE } from "@/lib/messages";
import { safeReturnTo } from "@/lib/text";

/** 切换界面语言（Cookie，一年）。 */
export async function GET(req: NextRequest) {
  const lang = req.nextUrl.searchParams.get("set") === "en" ? "en" : "ja";
  const res = NextResponse.redirect(new URL(safeReturnTo(req.nextUrl.searchParams.get("returnTo")), config.baseUrl));
  res.cookies.set(LOCALE_COOKIE, lang, { path: "/", maxAge: 31536000, sameSite: "lax", httpOnly: false, secure: config.baseUrl.startsWith("https://") });
  return res;
}
