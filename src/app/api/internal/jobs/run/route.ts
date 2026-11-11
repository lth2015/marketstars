import { bearerOk, problem } from "@/lib/api";
import { config } from "@/lib/config";
import { runEventJobs, runJobs } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  if (!bearerOk(req, config.jobToken)) return problem(401, "unauthorized", "job token required");
  try {
    // ?scope=events：只做事件分发（适合每分钟执行）
    const r = new URL(req.url).searchParams.get("scope") === "events" ? await runEventJobs() : await runJobs();
    console.log(JSON.stringify({ severity: "INFO", message: "jobs.run.ok", ...r }));
    return Response.json(r);
  } catch (e) {
    console.error(JSON.stringify({ severity: "ERROR", message: "jobs.run.failed", error: String(e) }));
    return problem(500, "job_failed", "job failed");
  }
}
