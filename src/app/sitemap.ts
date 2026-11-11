import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";
import { config } from "@/lib/config";
import { publicAppWhere } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = config.baseUrl;
  const [apps, help] = await Promise.all([
    prisma.app.findMany({ where: publicAppWhere, select: { slug: true, contentUpdatedAt: true, updatedAt: true } }),
    prisma.contentEntry.findMany({ where: { published: true, kind: { in: ["help", "terms", "privacy"] } }, select: { slug: true, updatedAt: true } }),
  ]);
  return [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/apps`, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/ranking`, changeFrequency: "daily", priority: 0.6 },
    { url: `${base}/help`, changeFrequency: "monthly", priority: 0.4 },
    ...apps.map((a) => ({ url: `${base}/apps/${a.slug}`, lastModified: a.contentUpdatedAt ?? a.updatedAt, changeFrequency: "weekly" as const, priority: 0.8 })),
    ...help.map((h) => ({ url: `${base}/help/${h.slug}`, lastModified: h.updatedAt, changeFrequency: "monthly" as const, priority: 0.3 })),
  ];
}
