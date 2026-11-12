# 图片存储（Cloud Storage）与多语言基础

## 图片存储
- `ASSET_STORAGE=db`（默认，本地 / 演示 / CI 的 e2e）：图片存在数据库里，经 `/api/assets/{id}` 提供。
- `ASSET_STORAGE=gcs`（dev / staging / production 的 overlay 都已配置）：
  - 上传到 `GCS_ASSETS_BUCKET`，即各项目的 `<project>-marketstars-assets`。bucket 的创建和权限见 `deploy/gcp/README.md` §9：公开可读，应用的服务账号有 objectAdmin。
  - 对象名用内容哈希 `assets/<sha256>.<ext>`，同一张图只存一份；设置 `Cache-Control: public, max-age=31536000, immutable`。
  - 返回 `https://storage.googleapis.com/<bucket>/...`（可用 `GCS_PUBLIC_BASE_URL` 改成 CDN 地址）。
  - 数据库只保留元数据（上传者、类型、大小、哈希）。
  - 在 GKE 上通过 Workload Identity 认证，没有密钥文件。
- 文件类型校验（按文件头判断 PNG / JPEG / WebP、拒绝 SVG、2MB 上限）在写入存储之前完成，两种模式相同。
- **测试**：`tests/integration/gcs-storage.test.ts` 用 fake-gcs-server 验证上传、读取、去重和拒绝伪装文件。CI 的 e2e job 会执行；本地没有模拟服务器时自动跳过。
- **从 db 迁移到 gcs**：已有的 `/api/assets/{id}` 地址照常可用，旧图片不需要搬迁；新上传的图片会进 GCS。

## 多语言基础
- 文案集中在 `src/lib/messages.ts`，目前有 `ja`（默认）和 `en` 两份字典。语言保存在 Cookie `ms_locale`，通过页脚的「Language / 言語」切换（`/locale?set=en&returnTo=…`，切换后回到原页面）。
- **已覆盖（面向客户的全部页面）**：`<html lang>`、页头导航、页脚、演示横幅、首页、应用列表与筛选、排行榜、应用详情（主按钮 9 种状态、各区块、套餐价格）、开通确认与开通表单、我的应用、合同详情（状态、管理操作、套餐变更、自动更新、用量）、账单与卡片、支付页、通知、帮助、咨询表单、404 与错误页、状态徽章。
- **接入应用（演示）**：AI POPメーカー 与 クチコミ返信アシスタント 的界面随语言切换；英文模式下，模板生成的文案与回复、发给模型网关的提示也使用英文（未配置 API key 时，mock 模型同样以英文回答）。
- **未覆盖**：运营后台、开发者门户、邮件与站内通知正文、服务端返回的业务错误信息（`BizError` 文案）、帮助与条款正文（存于数据库的内容）。
- **新增文案的做法**：页面里用 `await getMessages()` 取字典；客户端组件不能直接读 Cookie，由页面把对应的文案分组作为 `labels` 传入（参见 `ApplyForm`、`ContactForm`、`PayForm`）。往 `ja` / `en` 里加键，`en` 的类型是 `Messages`，缺键会在类型检查时报错。错误边界 `error.tsx` 是客户端组件，按 `<html lang>` 选择文案。
- 运营后台和开发者门户预计只用日语。
