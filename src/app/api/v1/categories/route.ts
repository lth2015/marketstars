import { NextResponse } from "next/server";
import { facets } from "@/lib/catalog";

export async function GET() {
  const f = await facets();
  const m = (x: { slug: string; name: string }[]) => x.map(({ slug, name }) => ({ slug, name }));
  return NextResponse.json({ categories: m(f.categories), industries: m(f.industries), integrations: m(f.integrations) });
}
