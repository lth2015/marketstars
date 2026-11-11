import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { cardInclude, publicAppWhere } from "@/lib/catalog";
import { appJson } from "@/lib/serialize";
import { problem } from "@/lib/api";

export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const a = await prisma.app.findFirst({ where: { ...publicAppWhere, slug }, include: { ...cardInclude, industries: true, integrationTags: true } });
  if (!a) return problem(404, "not_found", "app not found");
  return NextResponse.json({ ...appJson(a), overview: a.overview, screenshots: a.screenshots, industries: a.industries.map((i) => i.slug), integrations: a.integrationTags.map((i) => i.slug), integration_type: a.integrationType, accepting_new: a.acceptingNew, support: a.supportChannels, privacy_url: a.privacyUrl, terms_url: a.termsUrl, version: a.version });
}
