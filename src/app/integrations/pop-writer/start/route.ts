import { NextResponse, type NextRequest } from "next/server";
import { marketstars, setPopSession } from "../lib";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("ms_launch");
  if (!code) return NextResponse.redirect(new URL("/integrations/pop-writer?e=launch", req.url));
  try {
    const j = await marketstars().exchangeLaunch(code);
    await setPopSession({ u: j.user_id, n: j.user_name, t: j.tenant_id, tn: j.tenant_name, exp: Date.now() + 3600000 });
  } catch {
    return NextResponse.redirect(new URL("/integrations/pop-writer?e=denied", req.url));
  }
  return NextResponse.redirect(new URL("/integrations/pop-writer", req.url));
}
