import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { problem } from "@/lib/api";

export async function GET() {
  const s = await getSession();
  if (!s) return problem(401, "unauthenticated", "login required");
  return NextResponse.json({ user_id: s.userId, name: s.userName, tenant: { id: s.tenantId, name: s.tenantName, owner: s.isOwner }, csrf_token: s.csrfToken });
}
