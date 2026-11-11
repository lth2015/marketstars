import { bearerOk, problem } from "@/lib/api";
import { config } from "@/lib/config";
import { runEventJobs, runJobs } from "@/lib/jobs";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  if (!bearerOk(req, config.jobToken)) return problem(401, "unauthorized", "job token required");
  try {
    // ?scope=events：只做事件分发（适合每分钟执行）
    const r = new URL(req.url).searchParams.get("scope") === "events" ? await runEventJobs() : await runJobs();
    await log("INFO", "jobs.run.ok", { result: r });
    return Response.json(r);
  } catch (e) {
    await log("ERROR", "jobs.run.failed", { error: String(e) });
    return problem(500, "job_failed", "job failed");
  }
}
