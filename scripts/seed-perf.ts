// 性能测试用：在演示数据基础上补足到 200 个已发布应用（合成数据，仅限测试环境）。
import { PrismaClient } from "@prisma/client";
import { buildSearchText, derivePricing } from "../src/lib/catalog";

const prisma = new PrismaClient();
(async () => {
  const have = await prisma.app.count({ where: { status: "published" } });
  const cats = await prisma.category.findMany();
  const inds = await prisma.industry.findMany();
  const provider = await prisma.provider.upsert({ where: { ownerTenantId: "perf-provider" }, create: { name: "Perf Test Provider", ownerTenantId: "perf-provider" }, update: {} });
  for (let i = have; i < 200; i++) {
    const plans = i % 3 === 0 ? [{ priceType: "free", priceJpy: 0, trialDays: 0 }] : [{ priceType: "monthly", priceJpy: 500 + (i % 20) * 250, trialDays: i % 2 ? 14 : 0 }];
    const name = `テストアプリ ${i}`;
    const tagline = `性能測定用の合成アプリ ${i}。在庫・販促・接客などの業務を支援します。`;
    const app = await prisma.app.create({
      data: {
        slug: `perf-app-${i}`, status: "published", name, tagline, tags: "テスト 性能", providerId: provider.id,
        searchText: buildSearchText({ name, tagline, tags: "テスト 性能", providerName: provider.name }),
        overview: { problem: tagline }, launchUrl: "https://example.com", recommendWeight: i % 7 === 0 ? i : 0,
        ...derivePricing(plans), firstPublishedAt: new Date(Date.now() - i * 3600000),
        categories: { connect: [{ id: cats[i % cats.length].id }] }, industries: { connect: [{ id: inds[i % inds.length].id }] },
      },
    });
    await prisma.planVersion.create({ data: { appId: app.id, planKey: "p", name: "プラン", ...plans[0] } });
  }
  console.log("published apps:", await prisma.app.count({ where: { status: "published" } }));
})().finally(() => prisma.$disconnect());
