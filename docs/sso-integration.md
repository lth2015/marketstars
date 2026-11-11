# 公共 SSO 接入说明

依赖 [lth2015/sso](https://github.com/lth2015/sso)（master 的 README、`api/openapi.yaml`、`api/sso.openapi.yaml`、`docs/runbooks/public-api.md`）。本仓库不修改 SSO，也不写其数据库。

## 流程

1. `/auth/start` 生成 `state`、`nonce`、PKCE verifier（存 `AuthState` 表，10 分钟有效），重定向到 SSO 的 authorization endpoint（`code` + `S256`，带 `audience`）。密码、TOTP MFA、空间选择都在 SSO 的可信登录 / 同意页完成。
2. `/auth/callback` 校验 state，用 code 换 token（有 secret 时用 `client_secret_basic`），用 JWKS 验证 ID token 的 iss / aud / nonce。ID token 只用于确认身份。
3. 服务端用平台 access token 调 `GET /v1/me`（得到 `user_id`、`tenant_id`）和 `GET /v1/tenants`（得到空间名、`owner`）。然后建立服务端会话：表 `Session` 只保存 HMAC 后的会话 ID，浏览器只拿到 HttpOnly Cookie。
4. 会话每 60 秒复查一次 `/v1/me`，token 快过期时先用 refresh token 刷新。遇到 401/403、用户或空间不一致（成员停用、全设备退出、安全版本变化）时立即作废本地会话。
5. 切换空间（`/auth/switch`）带 `prompt=consent` 重新走授权，不允许只替换 tenant_id。
6. 退出：`/auth/logout` 删除本地会话并撤销本应用的 token。传 `global=1` 时跳到 SSO 的 `/sso/logout` 确认页，做全设备退出。

## 配置

| 变量 | 说明 |
| - | - |
| `AUTH_MODE` | `oidc`（staging/production 必须）或 `demo` |
| `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_REDIRECT_URI` | MarketStars 独立 client，回调必须在 SSO 白名单内；不复用示范用的 app-a / app-b |
| `OIDC_SCOPES` | 默认 `openid offline_access platform:read` |
| `SSO_API_BASE_URL` / `SSO_API_AUDIENCE` | 平台 API 地址和 audience（与 MarketStars 应用 audience 区分） |
| `SSO_ACCOUNT_URL` / `SSO_CONSOLE_URL` / `SSO_LOGOUT_URL` | 注册与安全设置页、组织成员控制台、全设备退出页 |
| `OPERATOR_SSO_TENANT_ID` | 运营空间。运营权限需要「在该空间登录」加上「有 `OperatorGrant` 记录」，两者都满足才行 |

## 接入应用（权益双检查）

- 「アプリを開く」(`/launch/:id`) 先在后端校验会话和有效权益，再签发 60 秒、单次有效的启动码（数据库只存哈希）。URL 中不放任何 token。
- 应用服务端用自己的 `client_id:secret`（`LAUNCH_CLIENT_SECRET_<ID>`）调用 `POST /api/v1/launch/exchange` 兑换身份，每次使用付费能力前再调用 `POST /api/v1/entitlements/check`。
- 示范应用 `src/app/integrations/pop-writer` 完整走通这条链路。正式接入时，应用自身还应接入同一个 SSO 校验登录。

## 待 SSO 侧补充

- 账号永久注销接口：当前只提供人工申请入口（`/contact?type=account_deletion`）。
- 生产 issuer、TLS、Secure Cookie、正式邮件，以及为 MarketStars 开通独立 client 和租户应用资格。
