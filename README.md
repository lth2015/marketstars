# MarketStars

面向日本商户的 AI 应用市场（V1.0 demo）。用户发现应用、查看价格、通过公共 SSO 登录、试用或申请开通，在「マイアプリ」中使用和退订；运营在后台管理目录、审批申请、确认收款。

- 技术栈：Next.js 15（App Router，Web + BFF + API 同一服务）、Prisma、MySQL（生产为 Cloud SQL for MySQL）
- 身份：公共 SSO [lth2015/sso](https://github.com/lth2015/sso)（OIDC code + S256 PKCE，经 Hydra；服务端调用 `/v1/me`、`/v1/tenants`）
- 部署：GCP 外部 Application LB + GKE Gateway API + GKE + Cloud SQL，见 [docs/deploy.md](docs/deploy.md) 与 [deploy/gcp/README.md](deploy/gcp/README.md)

P1 已包含：信用卡在线支付与自动续费、套餐自助变更、评分评论、开发者自助提交和审核，见 [docs/p1.md](docs/p1.md)。

## 本地运行

```bash
cp .env.example .env            # 默认 AUTH_MODE=demo（演示身份，生产禁止）
npm ci
npx prisma migrate deploy
npm run db:seed                 # 合成演示数据（不要在生产执行）
npm run build && npx next start -p 3000
curl -X POST -H "Authorization: Bearer local-job-token" localhost:3000/api/internal/jobs/run   # 计算排行等定时任务
```

需要本地 MySQL 8 / MariaDB，连接串见 `.env.example`。

演示身份（`/auth/login`）：
| 身份 | 空间 | 用途 |
| - | - | - |
| 山田 花子 | さくらベーカリー / みなと美容室（owner） | 试用、申请、退订、空间隔离 |
| 佐藤 健 | さくらベーカリー（成员） | 非 owner 只能「管理者に申し込みを依頼」 |
| 開発 次郎 | ミライAI合同会社（owner） | `/developer` 开发者提交审核 |
| 運営 太郎 | MarketStars 運営（运营空间 + OperatorGrant） | `/admin` 运营后台 |

接入公共 SSO：设置 `AUTH_MODE=oidc` 及 `OIDC_*`、`SSO_*` 变量，见 [docs/sso-integration.md](docs/sso-integration.md)。

## 测试

```bash
npm run typecheck
npm test                         # 单元测试：周期计算、搜索归一化、权益、安全校验
node tests/e2e.mjs               # P0 端到端验收（需服务已启动、demo 模式、已 seed）
node tests/e2e-p1.mjs            # P1 端到端验收（重新 seed 后运行）
```

## 目录

| 路径 | 内容 |
| - | - |
| `src/app` | 页面（首页、列表、排行、详情、开通确认、我的应用、账单、帮助、咨询、运营后台）与 API |
| `src/lib/subscriptions.ts` | 订阅状态机：试用/免费/付费申请、退订、运营确认收款/续期/暂停，幂等与唯一约束 |
| `src/lib/sso.ts`, `src/lib/session.ts` | SSO 适配与服务端会话（HttpOnly Cookie，token 只在服务端） |
| `src/app/integrations/pop-writer` | 示范接入应用（一次性启动码 + 权益复查） |
| `api/marketstars.openapi.yaml` | MarketStars OpenAPI（运行时 `/api/openapi`） |
| `prisma/` | 数据模型、迁移、种子数据 |
| `deploy/` | Dockerfile 之外的 GKE kustomize 清单与 GCP 搭建步骤 |
| `docs/` | 部署回滚、SSO 接入、验收记录 |
