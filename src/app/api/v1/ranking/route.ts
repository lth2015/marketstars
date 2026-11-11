import { NextResponse, type NextRequest } from "next/server";
import { getRanking } from "@/lib/catalog";

export async function GET(req: NextRequest) {
  const r = await getRanking(req.nextUrl.searchParams.get("category") ?? undefined);
  return NextResponse.json({ basis: "new_active_tenants_30d", computed_at: r.computedAt?.toISOString() ?? null, items: r.entries.map((e) => ({ rank: e.rank, count: e.count, slug: e.app.slug, name: e.app.name })) });
}
