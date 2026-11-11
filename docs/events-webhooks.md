# 事件、通知、邮件与提供商 Webhook

## 流程
1. 申请、状态变更、收款、续费失败、套餐变更、审核结果、新评论等业务操作，**在同一个数据库事务里**写入一条 `DomainEvent`（outbox 模式），保证不会漏发，也不会在业务回滚后误发。
2. 定时任务 `POST /api/internal/jobs/run?scope=events`（K8s 上每分钟一次）依次执行：
   1. **提醒**：试用将在 3 天内结束；未开启自动续费的付费订阅将在 7 天内到期。用 `dedupeKey` 保证每笔只提醒一次。
   2. **事件扇出**：把事件转成站内通知、邮件 outbox 和 Webhook 投递记录（三者都有唯一约束，重复执行不会重复生成）。
   3. **Webhook 投递**：失败按退避重试。
   4. **邮件发送**。
3. 事件目录（通知文案、是否发邮件、是否推 Webhook）集中在 `src/lib/events.ts`。

## 站内通知
- 页头铃铛显示未读数，`/my/notifications` 查看并标为已读。通知按空间发送，已读状态按用户记录。
- 带 `ownerOnly` 的通知只有 owner 能看到，例如付款、申请类通知。

## 邮件
- 收件人：owner 登录时从 SSO 的 email 声明中记下的地址（`TenantContact`）。
- `MAIL_TRANSPORT=log`（默认）：不对外发送，日志只记录收件域名和标题；完整内容可在运营后台「メール送信履歴」查看。
- `MAIL_TRANSPORT=smtp` 加上 `SMTP_URL` 和 `MAIL_FROM`：实际发送。生产环境需要把 `SMTP_URL` 加进 Secret Manager 和 ExternalSecret。
- 同一封邮件最多尝试 3 次。

## 提供商 Webhook
- 在开发者门户的应用页面配置：发送地址、事件类型、启用/停用、测试发送、投递记录、重发。
- **签名**：`X-MarketStars-Signature: t=<unix>,v1=hex(HMAC-SHA256(secret, "<t>.<body>"))`。密钥由主密钥和端点 ID 派生，不入库；轮换 `SESSION_SECRET` 时会一起轮换。接收方应校验签名，并拒绝 5 分钟以上的旧请求。
- **重试**：非 2xx 或超时（10 秒）时，按 1 分 → 5 分 → 30 分 → 2 小时 → 12 小时的间隔重试，共 6 次，之后标为 `dead`。用 `X-MarketStars-Delivery` 或事件 `id` 做幂等。
- **SSRF 防护**：
  - 登记时要求 https，拒绝认证信息、`localhost` 和内网字面地址。
  - **建立连接时**再按 DNS 解析结果检查每个地址，拒绝私网、回环、链路本地（含云元数据地址 169.254.169.254）、CGNAT 和组播地址，以防 DNS rebinding。
  - 不跟随重定向。
- `WEBHOOK_ALLOW_PRIVATE=true` 只用于本地和 CI（测试接收端在 127.0.0.1），**生产环境禁止设置**。

## 验收
- `tests/e2e-p4.mjs`，6 项：
  - 签名有效的测试推送
  - 试用开始时的通知和 Webhook
  - 投递失败后的退避与手动重发
  - 邮件 outbox
  - 提醒只发一次
  - 非 owner 看不到 owner 专属通知
- 单元测试：签名，以及 SSRF 防护（包括连接时拦截解析到内网的地址）。
