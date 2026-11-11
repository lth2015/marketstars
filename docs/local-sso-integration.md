# 本地与公共 SSO（lth2015/sso）联调手册

目标：在本地用真实的 SSO（Hydra + 账户页 + 平台 API）完成 A04 / A05 / A11 / A13 / A16 的人工验收，对照用的自动化测试是 `tests/e2e-oidc.mjs`（基于模拟 SSO，11 项）。

> MarketStars 对 SSO 的假设来自 lth2015/sso master 的合同。这些假设已用模拟 SSO 验证过，真实 SSO 的差异就是这次联调要找的东西。

## 0. 前提
- 两个仓库都在本地。lth2015/sso 需要访问 `go.dev`、Docker Hub、npm registry。
- 本机有 MySQL，或用本仓库的 `compose.local.yml` 起一个监听 3307 端口的 MySQL。
- MarketStars **直接在宿主机运行**。SSO 本地栈的端口只绑定 127.0.0.1，从容器里访问不到。

## 1. 启动 SSO（在 lth2015/sso 仓库）
```bash
scripts/install-go
```
```bash
scripts/api prepare
```
```bash
scripts/api up
```
就绪后的入口：
- 账户页：`auth.localhost:8080/account`
- OIDC issuer：`http://auth.localhost:4464/`
- 平台 API：`api.localhost:8083`
- Hydra Admin：`127.0.0.1:4465`（只在本机可访问）

## 2. 让 Node 能解析 *.localhost
浏览器认 `*.localhost`，但 Node 的 DNS 查询不一定认。在 `/etc/hosts` 里加一行：
```
127.0.0.1 auth.localhost api.localhost console.localhost
```

## 3. 注册 MarketStars 的 OAuth client（做法与 SSO 自带的 `local-console` 一致）
```bash
curl -sS -X POST http://127.0.0.1:4465/admin/clients -H 'content-type: application/json' -d '{
  "client_id": "marketstars-local",
  "client_secret": "<自己生成的 secret>",
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "redirect_uris": ["http://localhost:3000/auth/callback"],
  "scope": "openid offline_access platform:read",
  "audience": ["https://api.sso.local"],
  "token_endpoint_auth_method": "client_secret_basic"
}'
```
再在 SSO 业务库里把 client 绑定到 application（参考 `scripts/seed_sso.py` 里 `local-console` 那一行）：
```bash
docker compose --env-file .local/m0.env -f deploy/local/compose.yml exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot' <<'SQL'
-- 数据库名以 .local/sso-init.sql 中实际使用的为准
INSERT IGNORE INTO oauth_clients(client_id,application_id,redirect_uri,scopes,audience)
SELECT 'marketstars-local',id,'http://localhost:3000/auth/callback','openid offline_access platform:read','https://api.sso.local'
FROM applications WHERE code='local-platform';
SQL
```
> 需要和 SSO 负责人确认：PRD 要求 MarketStars 有「独立 client 和租户应用资格」。正式环境应当为 MarketStars 建一个独立的 application，这里先借用 `local-platform` 跑通流程。

## 4. 准备测试账户（在 SSO 账户页）
1. 在 `http://auth.localhost:8080/account` 注册两个账户 A 和 B，邮件验证码在 `.local/mailbox`。
2. 给它们开通应用：
   ```bash
   scripts/api enable --email A的邮箱 --second-tenant
   ```
   ```bash
   scripts/api enable --email B的邮箱
   ```
3. 让 B 成为 A 第二个空间的成员：在控制台（`console.localhost:3003`）用邀请功能。这样才能测 A11 的成员停用。

## 5. 启动 MarketStars（在本仓库）
```bash
docker compose -f compose.local.yml up -d
```
```bash
cp .env.local-sso.example .env.local-sso
```
填好 `OIDC_CLIENT_SECRET`，`OPERATOR_SSO_TENANT_ID` 先留空。然后：
```bash
set -a; . ./.env.local-sso; set +a
```
先跑接入预检，确认配置和 SSO 的实际行为一致（不需要浏览器，不改任何数据）：
```bash
npm run sso:doctor
```
它会逐项检查：必需变量、redirect URI 与 `APP_BASE_URL` 是否一致、DNS（`*.localhost`）、discovery、issuer 是否与 `OIDC_ISSUER` **完全一致**（含末尾斜杠）、PKCE S256、JWKS、client 凭据（用无效 code 换 token：`invalid_client` 说明 secret 或认证方式不对，`invalid_grant` 说明凭据正确）、redirect URI 是否已登记、平台 API 未带 token 时是否返回 401。有 FAIL 时退出码为 1，按提示修正后再继续。
```bash
npx prisma migrate deploy && npm run db:seed && npm run build
```
```bash
npx next start -p 3000
```
用账户 A 登录后，在 `/account` 页面能看到 SSO 的 user_id 和 tenant_id。指定运营空间和运营人员：
1. 把那个 tenant_id 填进 `OPERATOR_SSO_TENANT_ID`。
2. 执行下面的命令。
3. 重启 MarketStars。
```bash
npm run ops:grant -- <user_id>
```

## 6. 人工验收清单（与 e2e-oidc 一一对应）
| # | 操作 | 期望 |
| - | - | - |
| O1 / A04 | 未登录 → 应用详情 →「ログインして利用する」→ SSO 登录 + TOTP → 选空间 | 回到原应用页，页头显示空间名，没有自动购买 |
| O1' / A04 | 在 SSO 新注册 → 验证邮箱 → 回到 MarketStars 点「ログイン」 | 同上（注册完不会自动登录） |
| O2 | 开发者工具看 Cookie 和 JS | 只有 HttpOnly 的 `ms_session`；浏览器里没有任何 token |
| O3 | 开通试用后查 `Subscription.createdBy` | 等于 `/v1/me` 返回的 user_id（不是 ID token 里的 sub） |
| O4 | 等到 access token 过期后（Hydra 默认约 1 小时）继续操作 | 用 refresh token 续期，不会掉线 |
| O5 / A05 | `/auth/switch` → 在 SSO 选另一个空间 | 我的应用和账单换成新空间的数据；手动改 URL 里的 ID 也看不到别的空间的数据 |
| O6 / A11 | 在控制台停用 B 在 A 空间的成员资格 | 约 60 秒内（`SSO_REVERIFY_SECONDS`）B 的 MarketStars 会话失效 |
| O7 / A11 | 在 SSO 做全设备退出，或重置密码 | MarketStars 会话失效 |
| O8 | `/account` 里的「ログアウト」/「すべての端末からログアウト」 | 前者只退出 MarketStars；后者跳到 SSO 的确认页 |
| O9 / A13 | 在运营空间以外登录后访问 `/admin` | 拒绝访问；只有在运营空间登录、且有运营权限的用户能进 |
| O10 / A16 | 停掉 SSO（`scripts/sso down`） | 目录照常浏览；登录页显示重试提示；需要登录的页面不放行 |

## 7. 可能出现的差异与排查
- **`/v1/me` 返回 401/403**：确认 access token 的 audience 包含 `https://api.sso.local`，scope 有 `platform:read`，并且这个用户在所选空间已开通应用。MarketStars 发起授权时会带上 `audience` 参数。
- **同意页没有让选空间**：确认 client 已绑定到 application（第 3 步的 SQL）。
- **回调报 `state_unknown`**：同一浏览器重复点了登录，或者 AuthState 已过期（10 分钟），重新登录即可。
- **ID token 校验失败**：确认 issuer 的结尾斜杠和 `OIDC_ISSUER` 完全一致。
- **退出 MarketStars 时撤销 token 失败**：确认 Hydra 的 revocation endpoint 接受 `client_secret_basic`。撤销失败不会妨碍本地退出。
