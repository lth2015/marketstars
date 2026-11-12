// 演示/测试环境种子数据（命令行入口）。内容见 src/lib/demo-seed.ts，生产环境不要执行。
import { PrismaClient } from "@prisma/client";
import { seedDemo } from "../src/lib/demo-seed";

const prisma = new PrismaClient();
seedDemo(prisma)
  .then((n) => console.log("seeded", n, "apps"))
  .finally(() => prisma.$disconnect());
