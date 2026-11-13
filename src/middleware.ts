// 每个请求：生成 CSP nonce（Next 会自动加到自身脚本上）、请求 ID，并设置安全响应头。
import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const requestId = req.headers.get("x-request-id") ?? req.headers.get("x-cloud-trace-context")?.split("/")[0] ?? crypto.randomUUID();
  // 生产在 GCP LB 之后：以 LB 设置的 X-Forwarded-Proto 判断（中间件不依赖业务环境变量）
  const https = req.headers.get("x-forwarded-proto") === "https" || req.nextUrl.protocol === "https:";
  const dev = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob: https:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    // 表单只提交到本站；跨站跳转（如 SSO 全设备退出）经由中间页的链接进行
    "form-action 'self'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  const reqHeaders = new Headers(req.headers);
  reqHeaders.set("x-nonce", nonce);
  reqHeaders.set("x-request-id", requestId);
  // 供服务端组件得知当前路径（例如语言切换后回到原页面）
  reqHeaders.set("x-pathname", req.nextUrl.pathname + req.nextUrl.search);
  reqHeaders.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers: reqHeaders } });
  res.headers.set("content-security-policy", csp);
  res.headers.set("x-request-id", requestId);
  res.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.headers.set("cross-origin-opener-policy", "same-origin");
  if (https) res.headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  return res;
}

export const config = {
  // 静态资源、上传图片、托管应用（各自带更严格的 CSP/sandbox）不经过中间件
  matcher: [{ source: "/((?!_next/static|_next/image|fonts/|favicon.ico|placeholder-icon.svg|api/assets|hosted/).*)" }],
};
