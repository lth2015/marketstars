// 结构化日志（Cloud Logging 可解析的 JSON 单行）。带上 trace 以便与 LB 请求日志关联。
import { headers } from "next/headers";

type Severity = "DEBUG" | "INFO" | "WARNING" | "ERROR";

export async function requestContext() {
  try {
    const h = await headers();
    return { requestId: h.get("x-request-id") ?? undefined, trace: h.get("x-cloud-trace-context")?.split("/")[0] };
  } catch {
    return {}; // 不在请求上下文中（例如定时任务脚本）
  }
}

export async function log(severity: Severity, message: string, fields: Record<string, unknown> = {}) {
  const ctx = await requestContext();
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const entry = {
    severity, message, time: new Date().toISOString(), ...fields,
    ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
    ...(ctx.trace && project ? { "logging.googleapis.com/trace": `projects/${project}/traces/${ctx.trace}` } : {}),
  };
  (severity === "ERROR" ? console.error : console.log)(JSON.stringify(entry));
}
