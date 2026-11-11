// 测试用模拟 SSO：按 lth2015/sso 的对外合同实现最小子集，用于在 AUTH_MODE=oidc 下验证 MarketStars 的接入代码。
// 不是 SSO 的替代品，也不实现真实的密码/TOTP 校验（MFA 输入固定接受 123456）。
//   OIDC：/.well-known/openid-configuration、/oauth2/auth（登录+MFA+选择空间）、/oauth2/token（code+S256 PKCE / refresh）、/oauth2/revoke、JWKS
//   平台 API：GET /v1/me、GET /v1/tenants（Bearer，需 audience 与当前成员资格）
//   测试控制：POST /__admin/{suspend,restore,logout-all,down,up,reset}
// 用法：node tests/mock-sso/server.mjs   （PORT=4464，CLIENT_ID / CLIENT_SECRET / REDIRECT_URI 由环境变量指定）
import http from "node:http";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const jose = require("jose");

const PORT = Number(process.env.PORT ?? 4464);
const ISSUER = `http://127.0.0.1:${PORT}/`;
const CLIENT_ID = process.env.CLIENT_ID ?? "marketstars-local";
const CLIENT_SECRET = process.env.CLIENT_SECRET ?? "mock-client-secret";
const REDIRECT_URI = process.env.REDIRECT_URI ?? "http://127.0.0.1:3100/auth/callback";
const AUDIENCE = "https://api.sso.local";
const TOKEN_TTL = Number(process.env.TOKEN_TTL ?? 120);

const USERS = {
  u1: { id: "a1".repeat(16), name: "鈴木 一郎", email: "ichiro@example.test", tenants: [{ id: "b1".repeat(16), name: "鈴木商店", slug: "suzuki", owner: true }, { id: "b2".repeat(16), name: "駅前カフェ", slug: "ekimae", owner: false }] },
  u2: { id: "a2".repeat(16), name: "運営 花子", email: "ops2@example.test", tenants: [{ id: "c1".repeat(16), name: "MarketStars 運営", slug: "ms-ops", owner: true }] },
};
const state = { codes: new Map(), access: new Map(), refresh: new Map(), suspended: new Set(), down: false, sessions: new Map() };

const { publicKey, privateKey } = await jose.generateKeyPair("RS256");
const jwk = { ...(await jose.exportJWK(publicKey)), kid: "mock-1", alg: "RS256", use: "sig" };
const rand = () => crypto.randomBytes(24).toString("base64url");
const s256 = (v) => crypto.createHash("sha256").update(v).digest("base64url");
const send = (res, status, body, headers = {}) => { res.writeHead(status, { "content-type": typeof body === "string" ? "text/html; charset=utf-8" : "application/json", ...headers }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };
const problem = (res, status, title) => send(res, status, { type: "about:blank", title, status }, { "content-type": "application/problem+json" });
const readBody = (req) => new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d)); });
const findUser = (id) => Object.values(USERS).find((u) => u.id === id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function issue(userId, tenantId, sid) {
  const at = rand(), rt = rand();
  state.access.set(at, { userId, tenantId, sid, exp: Date.now() + TOKEN_TTL * 1000 });
  state.refresh.set(rt, { userId, tenantId, sid });
  return { at, rt };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, ISSUER);
  if (url.pathname.startsWith("/__admin/")) {
    const b = JSON.parse((await readBody(req)) || "{}");
    const op = url.pathname.slice(9);
    if (op === "suspend") state.suspended.add(`${b.user}:${b.tenant}`);
    else if (op === "restore") state.suspended.delete(`${b.user}:${b.tenant}`);
    else if (op === "logout-all") { for (const m of [state.access, state.refresh]) for (const [k, v] of m) if (v.userId === b.user) m.delete(k); }
    else if (op === "down") state.down = true;
    else if (op === "up") state.down = false;
    else if (op === "reset") { state.suspended.clear(); state.down = false; }
    return send(res, 200, { ok: true });
  }
  if (state.down) return problem(res, 503, "unavailable");

  if (url.pathname === "/.well-known/openid-configuration") {
    return send(res, 200, { issuer: ISSUER, authorization_endpoint: `${ISSUER}oauth2/auth`, token_endpoint: `${ISSUER}oauth2/token`, jwks_uri: `${ISSUER}.well-known/jwks.json`, revocation_endpoint: `${ISSUER}oauth2/revoke`, end_session_endpoint: `${ISSUER}sso/logout`, code_challenge_methods_supported: ["S256"] });
  }
  if (url.pathname === "/.well-known/jwks.json") return send(res, 200, { keys: [jwk] });

  if (url.pathname === "/oauth2/auth" && req.method === "GET") {
    const p = url.searchParams;
    if (p.get("client_id") !== CLIENT_ID || p.get("redirect_uri") !== REDIRECT_URI) return send(res, 400, "<h1>invalid client or redirect_uri</h1>");
    if (p.get("response_type") !== "code" || p.get("code_challenge_method") !== "S256" || !p.get("code_challenge") || !p.get("state")) return send(res, 400, "<h1>PKCE S256 and state required</h1>");
    if (p.get("audience") && p.get("audience") !== AUDIENCE) return send(res, 400, "<h1>audience not allowed</h1>");
    const hidden = [...p.entries()].map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join("");
    const users = Object.entries(USERS).map(([k, u]) => `<fieldset><legend>${esc(u.name)}</legend>${u.tenants.map((t) => `<label><input type="radio" name="pick" value="${k}:${t.id}" required> ${esc(t.name)}${t.owner ? "（owner）" : ""}</label><br>`).join("")}</fieldset>`).join("");
    return send(res, 200, `<!doctype html><meta charset="utf-8"><title>Mock SSO</title><h1>Mock SSO ログイン</h1><form method="post" action="/oauth2/auth">${hidden}${users}<label>MFA コード <input name="totp" id="totp"></label><button>許可して続行</button></form>`);
  }
  if (url.pathname === "/oauth2/auth" && req.method === "POST") {
    const f = new URLSearchParams(await readBody(req));
    if (f.get("totp") !== "123456") return send(res, 401, "<h1>MFA failed</h1>");
    const [key, tenantId] = (f.get("pick") ?? "").split(":");
    const user = USERS[key];
    if (!user || !user.tenants.some((t) => t.id === tenantId)) return send(res, 400, "<h1>bad tenant</h1>");
    if (f.get("redirect_uri") !== REDIRECT_URI) return send(res, 400, "<h1>bad redirect</h1>");
    const code = rand();
    const sid = rand();
    state.codes.set(code, { userId: user.id, tenantId, challenge: f.get("code_challenge"), nonce: f.get("nonce"), redirect: f.get("redirect_uri"), exp: Date.now() + 60000, sid });
    const to = new URL(REDIRECT_URI);
    to.searchParams.set("code", code);
    to.searchParams.set("state", f.get("state"));
    res.writeHead(302, { location: to.toString(), "set-cookie": `mock_sso_user=${user.id}; Path=/; HttpOnly` });
    return res.end();
  }
  if (url.pathname === "/oauth2/token" && req.method === "POST") {
    const auth = req.headers.authorization ?? "";
    const [id, secret] = Buffer.from(auth.replace(/^Basic /, ""), "base64").toString().split(":").map(decodeURIComponent);
    if (id !== CLIENT_ID || secret !== CLIENT_SECRET) return send(res, 401, { error: "invalid_client" });
    const f = new URLSearchParams(await readBody(req));
    if (f.get("grant_type") === "authorization_code") {
      const c = state.codes.get(f.get("code"));
      state.codes.delete(f.get("code"));
      if (!c || c.exp < Date.now() || c.redirect !== f.get("redirect_uri") || s256(f.get("code_verifier") ?? "") !== c.challenge) return send(res, 400, { error: "invalid_grant" });
      const u = findUser(c.userId);
      const { at, rt } = issue(c.userId, c.tenantId, c.sid);
      const idToken = await new jose.SignJWT({ nonce: c.nonce, name: u.name, email: u.email, sid: c.sid }).setProtectedHeader({ alg: "RS256", kid: "mock-1" }).setIssuer(ISSUER).setAudience(CLIENT_ID).setSubject(`pairwise-${c.userId.slice(0, 8)}`).setIssuedAt().setExpirationTime("10m").sign(privateKey);
      return send(res, 200, { access_token: at, refresh_token: rt, id_token: idToken, token_type: "bearer", expires_in: TOKEN_TTL });
    }
    if (f.get("grant_type") === "refresh_token") {
      const r = state.refresh.get(f.get("refresh_token"));
      if (!r) return send(res, 400, { error: "invalid_grant" });
      state.refresh.delete(f.get("refresh_token"));
      const { at, rt } = issue(r.userId, r.tenantId, r.sid);
      return send(res, 200, { access_token: at, refresh_token: rt, token_type: "bearer", expires_in: TOKEN_TTL });
    }
    return send(res, 400, { error: "unsupported_grant_type" });
  }
  if (url.pathname === "/oauth2/revoke" && req.method === "POST") {
    const f = new URLSearchParams(await readBody(req));
    state.access.delete(f.get("token"));
    state.refresh.delete(f.get("token"));
    return send(res, 200, {});
  }
  if (url.pathname === "/sso/logout") {
    const uid = /mock_sso_user=([a-f0-9]+)/.exec(req.headers.cookie ?? "")?.[1];
    for (const m of [state.access, state.refresh]) for (const [k, v] of m) if (v.userId === uid) m.delete(k);
    return send(res, 200, "<h1>すべての端末からログアウトしました</h1>");
  }
  if (url.pathname.startsWith("/v1/")) {
    const tok = state.access.get((req.headers.authorization ?? "").replace(/^Bearer /, ""));
    if (!tok || tok.exp < Date.now()) return problem(res, 401, "unauthorized");
    if (state.suspended.has(`${tok.userId}:${tok.tenantId}`)) return problem(res, 403, "membership_inactive");
    const u = findUser(tok.userId);
    if (url.pathname === "/v1/me") return send(res, 200, { user_id: u.id, tenant_id: tok.tenantId, membership_id: s256(u.id + tok.tenantId).slice(0, 32).toLowerCase().replace(/[^a-f0-9]/g, "a"), session_id: s256(tok.sid).slice(0, 32).toLowerCase().replace(/[^a-f0-9]/g, "b") });
    if (url.pathname === "/v1/tenants") return send(res, 200, { items: u.tenants.filter((t) => !state.suspended.has(`${u.id}:${t.id}`)).map((t) => ({ ...t, membership_id: "m".repeat(32), authz_version: 1, org_version: 1, root_id: "r".repeat(32) })), next_cursor: null });
  }
  return problem(res, 404, "not_found");
});
server.listen(PORT, "127.0.0.1", () => console.log(`mock sso on ${ISSUER}`));
