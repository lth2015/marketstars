import { NextResponse, type NextRequest } from "next/server";
import { config } from "@/lib/config";
import { basicAuth, setPopSession } from "../lib";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("ms_launch");
  if (!code) return NextResponse.redirect(new URL("/integrations/pop-writer?e=launch", req.url));
  const r = await fetch(`${config.baseUrl}/api/v1/launch/exchange`, { method: "POST", headers: { authorization: basicAuth(), "content-type": "application/json" }, body: JSON.stringify({ code }), cache: "no-store" });
  if (!r.ok) return NextResponse.redirect(new URL("/integrations/pop-writer?e=denied", req.url));
  const j = (await r.json()) as { user_id: string; user_name: string; tenant_id: string; tenant_name: string };
  await setPopSession({ u: j.user_id, n: j.user_name, t: j.tenant_id, tn: j.tenant_name, exp: Date.now() + 3600000 });
  return NextResponse.redirect(new URL("/integrations/pop-writer", req.url));
}
