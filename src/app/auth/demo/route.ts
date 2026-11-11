import { NextResponse, type NextRequest } from "next/server";
import { config } from "@/lib/config";
import { DEMO_PERSONAS } from "@/lib/demo-identities";
import { createSession, destroySession } from "@/lib/session";
import { safeReturnTo } from "@/lib/text";

export async function POST(req: NextRequest) {
  if (config.authMode !== "demo") return new NextResponse("Not found", { status: 404 });
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(config.baseUrl).origin && origin !== req.nextUrl.origin) return new NextResponse("Forbidden", { status: 403 });
  const fd = await req.formData();
  const p = DEMO_PERSONAS.find((x) => x.userId === fd.get("userId"));
  const t = p?.tenants.find((x) => x.id === fd.get("tenantId"));
  if (!p || !t) return NextResponse.redirect(new URL("/auth/login?error=1", req.url), 303);
  await destroySession();
  await createSession({ userId: p.userId, userName: p.name, email: p.email, tenantId: t.id, tenantName: t.name, isOwner: t.owner, authMode: "demo" });
  return NextResponse.redirect(new URL(safeReturnTo(String(fd.get("returnTo") ?? "/")), req.url), 303);
}
