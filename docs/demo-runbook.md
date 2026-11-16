# 11 月 17 日 11:00 联合演示手册

演示时间为 **2026-11-17 11:00，日本时间**。主环境已更新两个项目最新主干，保留原有演示账号、MFA 和空间。验收结束后冻结，演示前不再更新或重新构建。

## 开场前

1. 保持 Mac 开机、接电、不合盖；打开 Chrome 访问 http://localhost:13000。
2. 如果页面打不开，先启动 Docker Desktop，在 `/Users/lidawei/Documents/ChatGPT/marketplace` 双击 `启动演示.command`，等待检查完成。
3. 私有账号资料：本项目 `.local/demo-credentials.md`。主账号为 owner，普通成员为 auditor；不要投屏密码或 TOTP 密钥。
4. 管理员动态验证码可在任意终端直接执行：

```bash
/Users/lidawei/Documents/ChatGPT/marketplace/scripts/demo code owner
```

需要检查环境时运行 `scripts/demo readiness`；它只检查冻结版本和服务状态。验收后的 freeze 会阻止更新、重新构建、播种和再次彩排。

## 10 分钟演示

| 时间 | 画面与操作 | 讲解点 |
| --- | --- | --- |
| 0:00–1:00 | 首页、分类、应用详情 | 13 款合成示范应用，找到适合商店的工具 |
| 1:00–2:30 | 市场登录 → 共通账号 → owner 密码/MFA → 星河科技 | 使用真实 SSO、OAuth/PKCE、统一空间 |
| 2:30–4:00 | マイアプリ → AI POPメーカー → アプリを開く | 输入商品和特点，生成两套文案；启动前检查权益 |
| 4:00–5:30 | クチコミ返信アシスタント → 应用启动 → 两星评价 → 返信案を作る | 三套回复、空间内历史；勾选 AI 时演示本地 mock 模型网关与计量 |
| 5:30–6:30 | レジ締めチェック → 应用启动 | 1,000 円输入10张、レジの記録输入9,500；显示10,000与+500，说明静态托管和sandbox |
| 6:30–8:00 | 市场账户 → 組織・メンバーを管理（共通 SSO） | 统一会话可复用，展示组织、成员、角色和应用接入 |
| 8:00–9:00 | 市场账户 → 空間を切り替える → 远山合作社 | 看不到星河科技订阅，运营后台拒绝；随后切回星河科技 |
| 9:00–10:00 | 運営管理、開発者の方へ | 运营应用/合同/账单；提供者管理应用及托管构建 |

三款主线应用已开通，不需要现场重复申购。评价回复为 30 天试用，不会自动转为真实扣款。要演示首次免费开通，可选择尚未开通的シフト作成AI；其外链为占位，现场完整操作使用上述三款应用。

另一个无痕窗口可使用 auditor 登录星河科技：能看共享应用，不能申购或进入市场运营后台。执行 `scripts/demo code auditor` 获取其验证码。

## 三点避免卡顿

- 同一组 TOTP 只能成功使用一次。再次认证时等下一组，不要连续重复旧码。
- 固定使用 `localhost:13000`，不要改成 `127.0.0.1`；与其他本地项目一起使用时选独立 Chrome 个人资料或无痕会话。
- 使用市场账户页的普通「ログアウト」只退出市场。全设备退出会影响其他窗口，放到演示结束后。

## 已完成的验收

15 项真实浏览器检查通过，包括登录/MFA、目录、OAuth返回路径、HttpOnly会话、免费开通与实际SSO创建者、POP、评价回复试用/模型网关/历史、托管计算及sandbox、运营/开发者、空间隔离与越界URL、成员权限、普通退出保持SSO、无JavaScript错误，以及非本地浏览器请求被阻断时的市场和应用操作。完整报告在 `.local/rehearsal.json`。

入口预检为五项服务 PASS、OAuth 18 PASS/0 FAIL；discovery 未宣告 platform:read 保留一项提示，真实授权与API调用已通过。真实模型和支付凭证均未配置，当前展示本地模拟。

版本与截图见 [项目 README](../README.md)，精确提交见 [sources.json](local-demo/sources.json)，冻结和演示时间见 [demo-freeze.json](local-demo/demo-freeze.json)。SSO和市场均已完成构建与迁移，日常启动不需重新安装依赖。

## 恢复与结束

```bash
cd /Users/lidawei/Documents/ChatGPT/marketplace
scripts/demo readiness
scripts/demo up
scripts/demo status
```

市场日志：`.local/logs/marketstars.log`；运行守护日志：`.local/logs/readiness-watch.log`。容器设置 unless-stopped，本地进程守护和防睡眠持续到 11 月 17 日 12:00。它们只维持已构建服务，不更新代码。主动退出Docker、关机或合盖仍会中断演示。

结束后可双击 `停止演示.command`，它保留数据库、凭证和构建，并暂停市场守护恢复。在再次明确要求更改后才运行 `scripts/demo unfreeze`；演示前不要执行清库播种、reset、删卷或镜像prune。
