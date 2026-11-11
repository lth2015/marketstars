function env(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const config = {
  get baseUrl() { return env("APP_BASE_URL", "http://localhost:3000").replace(/\/$/, ""); },
  get authMode(): "oidc" | "demo" {
    const m = env("AUTH_MODE", "demo");
    if (m === "demo" && env("NODE_ENV") === "production" && env("ALLOW_DEMO_AUTH") !== "true") {
      // 生产默认禁止演示身份；dev 集群需显式 ALLOW_DEMO_AUTH=true
      return "oidc";
    }
    return m === "oidc" ? "oidc" : "demo";
  },
  get sessionSecret() { return env("SESSION_SECRET", "dev-only-secret"); },
  oidc: {
    get issuer() { return env("OIDC_ISSUER"); },
    get clientId() { return env("OIDC_CLIENT_ID"); },
    get clientSecret() { return env("OIDC_CLIENT_SECRET"); },
    get redirectUri() { return env("OIDC_REDIRECT_URI"); },
    get scopes() { return env("OIDC_SCOPES", "openid offline_access platform:read"); },
    get audience() { return env("SSO_API_AUDIENCE"); },
  },
  sso: {
    get apiBase() { return env("SSO_API_BASE_URL").replace(/\/$/, ""); },
    get accountUrl() { return env("SSO_ACCOUNT_URL"); },
    get consoleUrl() { return env("SSO_CONSOLE_URL"); },
    get logoutUrl() { return env("SSO_LOGOUT_URL"); },
  },
  get operatorTenantId() { return env("OPERATOR_SSO_TENANT_ID"); },
  get jobToken() { return env("JOB_TOKEN"); },
  launchSecret(clientId: string) {
    return env(`LAUNCH_CLIENT_SECRET_${clientId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`);
  },
  termsVersion: "2026-11-01",
};
