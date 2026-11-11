import { bearerOk, problem } from "@/lib/api";
import { config } from "@/lib/config";
import { runJobs } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  if (!bearerOk(req, config.jobToken)) return problem(401, "unauthorized", "job token required");
  try {
    const r = await runJobs();
    console.log(JSON.stringify({ severity: "INFO", message: "jobs.run.ok", ...r }));
    return Response.json(r);
  } catch (e) {
    console.error(JSON.stringify({ severity: "ERROR", message: "jobs.run.failed", error: String(e) }));
    return problem(500, "job_failed", "job failed");
  }
}
