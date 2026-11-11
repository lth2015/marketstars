import { NextResponse, type NextRequest } from "next/server";
import { listApps, parseListQuery } from "@/lib/catalog";
import { appJson } from "@/lib/serialize";

export async function GET(req: NextRequest) {
  const sp: Record<string, string[]> = {};
  req.nextUrl.searchParams.forEach((v, k) => (sp[k] ??= []).push(v));
  const q = parseListQuery(sp);
  const r = await listApps(q);
  return NextResponse.json({ total: r.total, page: q.page, per_page: q.perPage, pages: r.pages, items: r.items.map(appJson) });
}
