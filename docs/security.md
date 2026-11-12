# 安全加固

## 响应头（`src/middleware.ts` 加 `next.config.ts`）
- **CSP**：每个请求生成 nonce，Next 会自动加到自己的脚本上。
  ```
  default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic'; style-src 'self' 'unsafe-inline';
  font-src 'self'; img-src 'self' data: blob: https:; connect-src 'self'; object-src 'none';
  base-uri 'self'; frame-ancestors 'none'; form-action 'self'（https 时加 upgrade-insecure-requests）
  ```
  - `style-src` 保留 `'unsafe-inline'`，因为界面里用了大量内联 style 属性，脚本仍受 nonce 限制。
  - 表单只提交到本站。跨站跳转（例如跳到 SSO 的全设备退出页）通过中间页 `/auth/logged-out` 的链接或 meta refresh 完成。
- **其他头**：`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、`Referrer-Policy`、`Permissions-Policy`（关闭摄像头、麦克风、定位、支付）、`Cross-Origin-Opener-Policy: same-origin`；LB 传来 `X-Forwarded-Proto: https` 时加 HSTS。
- 中间件**不读取业务环境变量**（只看请求本身），同一个镜像在各个环境下行为一致。
- **重定向地址一律基于 `APP_BASE_URL`**，不使用 `req.url`。在 LB 后面时请求里的主机名可能是内部地址；以不同主机名访问时，重定向还会被 `form-action` 拦下。

## 限流（`src/lib/ratelimit.ts`）
- 数据库固定窗口计数：`INSERT … ON DUPLICATE KEY UPDATE` 原子自增，多副本共享。数据库出错时放行（fail-open），粗粒度防护交给 LB 层的 Cloud Armor。

| 对象 | 计数键 | 限制 |
| - | - | - |
| `/auth/start`、`/auth/demo` | 客户端 IP | 30 / 分钟 |
| `/auth/callback` | 客户端 IP | 60 / 分钟 |
| 咨询表单 | 客户端 IP | 5 / 10 分钟 |
| 申请、支付操作 | 用户 | 20 / 分钟 |
| 代理 API | 授权（mandate） | 120 / 分钟 |
| 模型网关 | 应用 + 空间 | 120 / 分钟 |
| 启动码兑换 | 应用 | 60 / 分钟 |
| 支付回调 | 客户端 IP | 300 / 分钟 |

- **客户端 IP**：
  - 生产环境设 `TRUSTED_PROXY_HOPS=1`。GCP 外部 LB 会在 `X-Forwarded-For` 末尾追加「客户端 IP, LB IP」，取 LB 前面那一项；客户端自己伪造的前缀不会改变计数键。
  - `TRUSTED_PROXY_HOPS=0`（前面没有可信代理）时，`X-Forwarded-For` 不可信，整体忽略。
  - 识别不出 IP 时不按 IP 限流。
- 超限返回 429 和 `Retry-After`；表单类操作显示提示文字。

## 日志与请求 ID
- 沿用 `x-request-id` 或 LB 的 `x-cloud-trace-context`，没有就生成一个，并写回响应头。
- `src/lib/log.ts` 输出单行 JSON（`severity`、`message`、`requestId`）。设置了 `GOOGLE_CLOUD_PROJECT` 时还会输出 `logging.googleapis.com/trace`，Cloud Logging 可以把它和 LB 的请求日志关联起来。
- 日志不记录 token、邮件正文、卡号。

## 其他
- **链接不预取有副作用的路由**：`/launch`、`/auth/*`、CSV/JSON 导出、API 文档都用普通 `<a>`，避免 Next 的 `<Link>` 预取去触发启动码签发或重定向。
- **字体自托管**：Noto Sans JP 按 unicode-range 分片，页面 load 之后才加载，使用 `font-display: optional`。不依赖外部字体服务，CSP 也不用放行外部字体域名。

## 验收
- `tests/e2e-p6.mjs` 5 项：
  - 每个脚本都带当次请求的 nonce，没有 CSP 违规
  - 请求 ID
  - 安全头
  - 按 IP 限流，伪造 `X-Forwarded-For` 前缀无法逃逸
  - 咨询表单限流
- 单元测试：客户端 IP 的解析规则。

## 2026-11-12 独立审查后的加固
- **Webhook SSRF**：IPv6 字面量地址（如 `[::1]`、`[::ffff:a9fe:a9fe]`）先去掉方括号再判断；也覆盖 IPv4 映射的十六进制写法、NAT64、6to4、ULA、链路本地等地址。IP 字面量的主机不会经过 DNS lookup，所以在连接前直接检查。已停用的端点不再投递。
- **开放重定向**：`safeReturnTo` 拒绝含控制字符或空白的值（URL 解析会删掉 Tab 和换行，`/\t/evil.com` 会变成 `//evil.com`），并确认解析后仍是同源，只返回路径、查询和片段。
- **登录 CSRF**：`/auth/start` 把 state 写入短期 Cookie（HttpOnly、SameSite=Lax、path=/auth），callback 只在 Cookie 一致时才交换授权码。他人发来的 state/code 无法让你以其账号登录。
- **审核绕过**：运营审批或退回时会比对其看到的提交（`submittedAt`），发布时先锁定应用行再读取草稿。开发者无法在运营打开审核页之后撤回、改写，再让未经审核的内容被公开。
- **自评**：提供商本身的空间和内部测试的使用不能发表评价。
- **链接与图片**：利用规约和隐私政策链接只接受 https 或站内路径；提供商的网站和支持 URL 只接受 https；图片只接受 https、data URI 和已上传的资产。
- Webhook 签名密钥只对 owner 显示；套餐停用会确认该套餐属于此应用；当前认证方式以外的会话（例如生产环境 OIDC 下残留的 demo 会话）不予使用。
