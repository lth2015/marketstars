import { NextResponse, type NextRequest } from "next/server";
import { config } from "@/lib/config";
import { prisma } from "@/lib/db";
import { seedDemo } from "@/lib/demo-seed";
import { runJobs } from "@/lib/jobs";
import { invalidateCatalog } from "@/lib/cache";
import { destroySession } from "@/lib/session";
import { limitIp, LIMITS, tooMany } from "@/lib/ratelimit";
import { log } from "@/lib/log";

/** デモデータを初期状態に戻す（再シード＋定期ジョブ）（AUTH_MODE=demo のときだけ存在）。全セッションも消えるため、ガイドへ戻す。 */
export async function POST(req: NextRequest) {
  if (config.authMode !== "demo") return new NextResponse("Not found", { status: 404 });
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(config.baseUrl).origin && origin !== req.nextUrl.origin) return new NextResponse("Forbidden", { status: 403 });
  const rl = await limitIp("auth", LIMITS.authStart, req);
  if (!rl.ok) return tooMany(rl.retryAfter);
  const fd = await req.formData();
  if (fd.get("confirm") !== "on") return NextResponse.redirect(new URL("/demo?error=confirm", config.baseUrl), 303);
  const apps = await seedDemo(prisma);
  // 定期ジョブも一度実行：ランキング、台帳への記帳、先月分の精算書がそろった状態から始められる
  await runJobs();
  invalidateCatalog();
  await destroySession();
  await log("INFO", "demo.reset", { apps });
  return NextResponse.redirect(new URL("/demo?reset=1", config.baseUrl), 303);
}
