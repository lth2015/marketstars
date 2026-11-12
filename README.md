# MarketStars

面向日本商户的 AI 应用市场（V1.0 demo）。用户发现应用、查看价格、通过公共 SSO 登录、试用或申请开通，在「マイアプリ」中使用和退订；运营在后台管理目录、审批申请、确认收款。

- 技术栈：Next.js 15（App Router，Web + BFF + API 同一服务）、Prisma、MySQL（生产为 Cloud SQL for MySQL）
- 身份：公共 SSO [lth2015/sso](https://github.com/lth2015/sso)（OIDC code + S256 PKCE，经 Hydra；服务端调用 `/v1/me`、`/v1/tenants`）
- 部署：GCP 外部 Application LB + GKE Gateway API + GKE + Cloud SQL，见 [docs/deploy.md](docs/deploy.md) 与 [deploy/gcp/README.md](deploy/gcp/README.md)

P1 已包含：信用卡在线支付与自动续费、套餐自助变更、评分评论、开发者自助提交和审核，见 [docs/p1.md](docs/p1.md)。
后续阶段已包含：统一模型网关与 SDK、Token 按量收费、供应商自动分账、开发者图片上传，见 [docs/gateway-and-payouts.md](docs/gateway-and-payouts.md)；AgentPay 与防篡改精算台帐，见 [docs/agentpay-ledger.md](docs/agentpay-ledger.md)；事件、通知、邮件与提供商 Webhook，见 [docs/events-webhooks.md](docs/events-webhooks.md)；安全加固见 [docs/security.md](docs/security.md)；图片存储（Cloud Storage）与多语言基础见 [docs/storage-i18n.md](docs/storage-i18n.md)。

## 本地运行

```bash
cp .env.example .env            # 默认 AUTH_MODE=demo（演示身份，生产禁止）
npm ci
npx prisma migrate deploy
npm run db:seed                 # 合成演示数据（不要在生产执行）
npm run build && npx next start -p 3000
curl -X POST -H "Authorization: Bearer local-job-token" localhost:3000/api/internal/jobs/run   # 计算排行等定时任务
```

需要本地 MySQL 8（推荐 `docker compose -f compose.local.yml up -d`，端口 3307），连接串见 `.env.example`。生产为 Cloud SQL for MySQL 8，请不要用 MariaDB 代替：MariaDB 允许 TEXT/JSON 列有默认值等，MySQL 8 会拒绝，迁移可能在本地通过、上线失败。CI 的 e2e job 使用 MySQL 8。

演示身份（`/auth/login`）：
| 身份 | 空间 | 用途 |
| - | - | - |
| 山田 花子 | さくらベーカリー / みなと美容室（owner） | 试用、申请、退订、空间隔离 |
| 佐藤 健 | さくらベーカリー（成员） | 非 owner 只能「管理者に申し込みを依頼」 |
| 開発 次郎 | ミライAI合同会社（owner） | `/developer` 开发者提交审核 |
| 運営 太郎 | MarketStars 運営（运营空间 + OperatorGrant） | `/admin` 运营后台 |

**演示向导 `/demo`**（页面顶部横幅里的「デモガイド」，仅 demo 模式）：沿功能主线列出 9 个场景（免费体验 → 打开应用用 AI 生成文案、银行卡开通、请求书支付与运营确认收款、契约管理、权限与空间隔离、开发者提交与审核、运营 KPI 与台帐、AgentPay、英文界面）。每一步的「開く」按钮会以指定的身份和空间重新登录并打开对应页面。页面底部可以把演示数据**一键恢复到初始状态**（等同于重新 `npm run db:seed` 并重算排行；所有人会被登出）。

接入公共 SSO：设置 `AUTH_MODE=oidc` 及 `OIDC_*`、`SSO_*` 变量，见 [docs/sso-integration.md](docs/sso-integration.md)；本地与真实 SSO 联调见 [docs/local-sso-integration.md](docs/local-sso-integration.md)。

## 测试

```bash
npm run typecheck
npm test                         # 单元测试：周期计算、搜索归一化、权益、安全校验
node tests/e2e.mjs               # P0 端到端验收（需服务已启动、demo 模式、已 seed）
node tests/e2e-p1.mjs            # P1 端到端验收（重新 seed 后运行）
node tests/e2e-p2.mjs            # 模型网关 / 按量计费 / 分账 / 上传（重新 seed 后运行）
node tests/e2e-p3.mjs            # AgentPay / 精算台帐（重新 seed 后运行）
node tests/e2e-p4.mjs            # 事件 / 通知 / 邮件 / 提供商 Webhook（重新 seed 后运行）
node tests/e2e-p5.mjs            # 运营 KPI / 开发者分析
node tests/e2e-p6.mjs            # 安全（CSP、限流、请求 ID）；服务需 TRUSTED_PROXY_HOPS=1
node tests/e2e-p7.mjs            # 多语言（日 / 英）
node tests/e2e-oidc.mjs          # AUTH_MODE=oidc + 模拟 SSO（自行启动端口 3100 / 4464）
scripts/e2e-all.sh               # 以上全部（CI 的 e2e job 也用它）
npx tsx scripts/seed-perf.ts && node tests/perf.mjs   # 性能（200 个应用、50 并发）
```

## 目录

| 路径 | 内容 |
| - | - |
| `src/app` | 页面（首页、列表、排行、详情、开通确认、我的应用、账单、帮助、咨询、运营后台）与 API |
| `src/lib/subscriptions.ts` | 订阅状态机：试用/免费/付费申请、退订、运营确认收款/续期/暂停，幂等与唯一约束 |
| `src/lib/sso.ts`, `src/lib/session.ts` | SSO 适配与服务端会话（HttpOnly Cookie，token 只在服务端） |
| `src/app/integrations/pop-writer` | 示范接入应用（一次性启动码 + 权益复查 + 通过模型网关调用 AI） |
| `src/sdk/marketstars.ts` | 接入应用用的服务端 SDK（启动码兑换、权益复查、模型调用） |
| `api/marketstars.openapi.yaml` | MarketStars OpenAPI（运行时 `/api/openapi`） |
| `prisma/` | 数据模型、迁移、种子数据 |
| `deploy/` | Dockerfile 之外的 GKE kustomize 清单与 GCP 搭建步骤 |
| `docs/` | 部署回滚、SSO 接入、验收记录 |
