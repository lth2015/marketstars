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
- **已覆盖**：`<html lang>`、页头导航、登录与注册、搜索、通知的无障碍标签、页脚、演示横幅、首页主视觉、详情页主按钮的全部 9 种状态与说明文字、状态徽章。
- **未覆盖**：各页面的正文、表单、运营后台、开发者门户、邮件和通知文案，目前仍是日语。后续按页面迁移：页面里用 `await getMessages()` 取字典，往 `ja` / `en` 里加对应的键，类型检查会确保两种语言的键一致。
- 运营后台和开发者门户预计只用日语。
