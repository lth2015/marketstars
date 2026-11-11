// SSO 接入预检：在联调前逐项检查 MarketStars 的 OIDC / 平台 API 配置与 SSO 的实际行为是否一致。
// 读取与应用相同的环境变量（OIDC_*、SSO_*、APP_BASE_URL），不修改任何数据，不需要浏览器。
//   set -a; . ./.env.local-sso; set +a; npm run sso:doctor
// 退出码：有 FAIL 时为 1；只有 WARN 时为 0。
import { lookup } from "node:dns/promises";

type Level = "PASS" | "WARN" | "FAIL" | "SKIP";
const rows: { level: Level; name: string; detail: string }[] = [];
const report = (level: Level, name: string, detail = "") => {
  rows.push({ level, name, detail });
  const mark = { PASS: "✓", WARN: "!", FAIL: "✗", SKIP: "-" }[level];
  console.log(`${mark} ${level.padEnd(4)} ${name}${detail ? `\n         ${detail}` : ""}`);
};

const env = (k: string) => (process.env[k] ?? "").trim();
const TIMEOUT = Number(env("SSO_DOCTOR_TIMEOUT_MS") || 5000);

async function get(url: string, init: RequestInit = {}) {
  return fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT) });
}
function describe(e: unknown) {
  const err = e as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  if (err.name === "TimeoutError") return `timeout after ${TIMEOUT}ms`;
  return err.cause?.code ? `${err.cause.code} ${err.cause.message ?? ""}`.trim() : String(err.message ?? e);
}

async function main() {
  console.log("MarketStars SSO doctor\n");

  // 1. 配置
  const mode = env("AUTH_MODE") || "demo";
  if (mode === "oidc") report("PASS", "AUTH_MODE=oidc");
  else report("WARN", `AUTH_MODE=${mode}`, "the app uses demo identities in this mode; set AUTH_MODE=oidc to use SSO");

  const required = ["APP_BASE_URL", "OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_REDIRECT_URI", "SSO_API_BASE_URL", "SSO_API_AUDIENCE", "SESSION_SECRET"];
  const missing = required.filter((k) => !env(k));
  if (missing.length) report("FAIL", "required variables", `missing: ${missing.join(", ")}`);
  else report("PASS", "required variables", required.join(", "));
  for (const k of ["SSO_LOGOUT_URL", "SSO_ACCOUNT_URL", "OPERATOR_SSO_TENANT_ID"]) if (!env(k)) report("WARN", k, "not set (logout-all / account links / operator access will not work)");

  const base = env("APP_BASE_URL").replace(/\/$/, "");
  const redirect = env("OIDC_REDIRECT_URI");
  if (base && redirect) {
    if (redirect === `${base}/auth/callback`) report("PASS", "redirect URI matches APP_BASE_URL", redirect);
    else report("FAIL", "redirect URI does not match APP_BASE_URL", `expected ${base}/auth/callback, got ${redirect}`);
  }
  if (env("SESSION_SECRET") && env("SESSION_SECRET").length < 32) report("WARN", "SESSION_SECRET", "shorter than 32 characters");
  const scopes = (env("OIDC_SCOPES") || "openid offline_access platform:read").split(/\s+/);
  for (const sc of ["openid", "offline_access", "platform:read"]) if (!scopes.includes(sc)) report("FAIL", "OIDC_SCOPES", `missing ${sc}`);

  const issuer = env("OIDC_ISSUER");
  if (!issuer) return;

  // 2. DNS（Node 不一定能解析 *.localhost，见 docs/local-sso-integration.md §2）
  for (const host of new Set([issuer, env("SSO_API_BASE_URL")].filter(Boolean).map((u) => new URL(u).hostname))) {
    try {
      const { address } = await lookup(host);
      report("PASS", `DNS ${host}`, address);
    } catch (e) {
      report("FAIL", `DNS ${host}`, `${describe(e)} — add it to /etc/hosts (e.g. 127.0.0.1 ${host})`);
    }
  }

  // 3. Discovery
  const discoveryUrl = issuer.replace(/\/$/, "") + "/.well-known/openid-configuration";
  let d: Record<string, unknown> | null = null;
  try {
    const r = await get(discoveryUrl);
    if (!r.ok) report("FAIL", "discovery", `${discoveryUrl} → HTTP ${r.status}`);
    else { d = await r.json(); report("PASS", "discovery", discoveryUrl); }
  } catch (e) {
    report("FAIL", "discovery", `${discoveryUrl} → ${describe(e)}`);
  }
  if (!d) return summary();

  // id_token 的 iss 必须与配置完全一致（含末尾斜杠），否则登录回调时验签失败
  if (d.issuer === issuer) report("PASS", "issuer matches OIDC_ISSUER exactly", String(d.issuer));
  else report("FAIL", "issuer mismatch", `discovery says ${JSON.stringify(d.issuer)}, OIDC_ISSUER is ${JSON.stringify(issuer)} (trailing slash matters)`);

  for (const k of ["authorization_endpoint", "token_endpoint", "jwks_uri"]) {
    if (typeof d[k] === "string") report("PASS", k, String(d[k]));
    else report("FAIL", k, "missing in discovery");
  }
  if (typeof d.revocation_endpoint === "string") report("PASS", "revocation_endpoint", String(d.revocation_endpoint));
  else report("WARN", "revocation_endpoint", "missing; app-only logout cannot revoke refresh tokens");

  const methods = d.code_challenge_methods_supported as string[] | undefined;
  if (!methods) report("WARN", "PKCE S256", "code_challenge_methods_supported not advertised");
  else if (methods.includes("S256")) report("PASS", "PKCE S256 supported");
  else report("FAIL", "PKCE S256", `supported: ${methods.join(", ")}`);

  const supportedScopes = d.scopes_supported as string[] | undefined;
  if (supportedScopes) {
    const lack = scopes.filter((sc) => !supportedScopes.includes(sc));
    if (lack.length) report("WARN", "scopes_supported", `not advertised: ${lack.join(", ")} (may still be allowed per client)`);
    else report("PASS", "scopes_supported", scopes.join(" "));
  }
  const authMethods = d.token_endpoint_auth_methods_supported as string[] | undefined;
  if (authMethods && !authMethods.includes("client_secret_basic")) report("FAIL", "client_secret_basic", `token endpoint supports: ${authMethods.join(", ")}`);

  // 4. JWKS
  try {
    const r = await get(String(d.jwks_uri));
    const keys = ((await r.json()) as { keys?: { kty?: string; alg?: string; use?: string }[] }).keys ?? [];
    const sig = keys.filter((k) => !k.use || k.use === "sig");
    if (r.ok && sig.length) report("PASS", "JWKS", `${sig.length} signing key(s): ${sig.map((k) => k.alg ?? k.kty).join(", ")}`);
    else report("FAIL", "JWKS", `HTTP ${r.status}, ${keys.length} key(s)`);
  } catch (e) {
    report("FAIL", "JWKS", describe(e));
  }

  // 5. Client 凭据：用无效的 code 换 token。凭据错误 → invalid_client（401）；凭据正确 → invalid_grant（400）。
  try {
    const basic = Buffer.from(`${encodeURIComponent(env("OIDC_CLIENT_ID"))}:${encodeURIComponent(env("OIDC_CLIENT_SECRET"))}`).toString("base64");
    const r = await get(String(d.token_endpoint), {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: "sso-doctor-invalid-code", redirect_uri: redirect, code_verifier: "x".repeat(43) }),
    });
    const body = (await r.json().catch(() => ({}))) as { error?: string; error_description?: string };
    if (body.error === "invalid_client" || r.status === 401) report("FAIL", "client credentials", `token endpoint says ${body.error ?? r.status}: check OIDC_CLIENT_ID / OIDC_CLIENT_SECRET and token_endpoint_auth_method=client_secret_basic`);
    else if (body.error === "invalid_grant" || body.error === "invalid_request") report("PASS", "client credentials accepted", `probe code rejected as ${body.error} (expected)`);
    else report("WARN", "client credentials", `unexpected answer: HTTP ${r.status} ${body.error ?? ""} ${body.error_description ?? ""}`.trim());
  } catch (e) {
    report("FAIL", "token endpoint", describe(e));
  }

  // 6. 授权端点：redirect_uri 未登记时，SSO 不会跳回 MarketStars
  try {
    const u = new URL(String(d.authorization_endpoint));
    u.searchParams.set("client_id", env("OIDC_CLIENT_ID"));
    u.searchParams.set("redirect_uri", redirect);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", scopes.join(" "));
    u.searchParams.set("state", "sso-doctor-state-000000");
    u.searchParams.set("code_challenge", "E9Melhoa2OwvFrEMTJguCQaoeKfmPZiK3dHoaMXDgXY");
    u.searchParams.set("code_challenge_method", "S256");
    const r = await get(u.toString());
    const loc = r.headers.get("location") ?? "";
    const toCallbackWithError = loc.startsWith(redirect) && /[?&]error=/.test(loc);
    const errorPage = /error=(invalid_client|invalid_request|unauthorized_client)/.test(loc) || (r.status >= 400 && r.status < 500);
    if (toCallbackWithError) {
      const err = new URL(loc).searchParams.get("error");
      report(err === "invalid_scope" ? "FAIL" : "WARN", "authorization request", `SSO redirected back with error=${err} (${new URL(loc).searchParams.get("error_description") ?? ""})`);
    } else if (errorPage) report("FAIL", "authorization request", `rejected (HTTP ${r.status}${loc ? ` → ${loc.slice(0, 160)}` : ""}); is the redirect URI registered for this client?`);
    else report("PASS", "authorization request accepted", r.status >= 300 && r.status < 400 ? `→ ${loc.slice(0, 120)}` : `HTTP ${r.status}`);
  } catch (e) {
    report("FAIL", "authorization endpoint", describe(e));
  }

  // 7. 平台 API：未带 token 时应当是 401，而不是连不上或 404
  const api = env("SSO_API_BASE_URL").replace(/\/$/, "");
  if (api) {
    for (const path of ["/v1/me", "/v1/tenants"]) {
      try {
        const r = await get(api + path);
        if (r.status === 401) report("PASS", `API ${path} requires a token`, "HTTP 401 without Authorization");
        else if (r.status === 404) report("FAIL", `API ${path}`, "HTTP 404: check SSO_API_BASE_URL");
        else report("WARN", `API ${path}`, `HTTP ${r.status} without a token (expected 401)`);
      } catch (e) {
        report("FAIL", `API ${path}`, describe(e));
      }
    }
  }

  // 8. MarketStars 自身（可选）：应用是否在 APP_BASE_URL 上运行
  if (base) {
    try {
      const r = await get(`${base}/api/healthz`);
      report(r.ok ? "PASS" : "WARN", "MarketStars healthz", `${base}/api/healthz → HTTP ${r.status}`);
    } catch {
      report("SKIP", "MarketStars healthz", `${base} is not running (start it before logging in)`);
    }
  }
  return summary();
}

function summary() {
  const n = (l: Level) => rows.filter((r) => r.level === l).length;
  console.log(`\n${n("PASS")} passed, ${n("WARN")} warnings, ${n("FAIL")} failed${n("SKIP") ? `, ${n("SKIP")} skipped` : ""}`);
  process.exitCode = n("FAIL") ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
