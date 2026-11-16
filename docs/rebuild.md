# 持续更新本地联合演示

Marketstars 与 SSO 可以继续开发，本项目负责在需要时把已提交的代码更新到本地演示环境。所有 Git 操作针对本项目的私有副本，不切换 Claude 或其他开发者的工作区，不推送远程代码。

## 日常操作

```bash
scripts/demo update --check
scripts/demo update
```

第一条查询跟踪分支并显示新旧 commit，不构建、不停服务。第二条真正执行更新；默认跟踪 Marketstars `main` 和 SSO `master`。可以覆盖分支、标签或提交：

```bash
scripts/demo update --marketstars-ref claude/实际开发分支名
scripts/demo update --marketstars-ref main --sso-ref master
scripts/demo update --marketstars-ref 实际提交SHA --sso-ref 实际提交SHA
```

参数中的示例名称需换成实际 ref；指定后会记录为下一次更新的目标。代码尚未 commit/push 时不会被远程更新获取；需要等对应开发工作提交后再更新。

只重新编译当前已固定的版本、不取新代码：

```bash
scripts/demo rebuild
```

执行 `scripts/demo versions` 查看已验证的具体版本。`启动演示.command` 与 `scripts/demo up` 只负责启动当前版本，不会意外更新代码。

## 每次重建的行为

1. 在 `.local/candidates/` 建立独立候选副本，继承原有私有密钥和 SSO 账号配置；安装依赖、构建市场和 SSO。这段时间旧演示仍可使用。
2. 构建通过后暂停市场和 SSO 写入，生成一致的私有 SQL 快照，保留旧代码、构建文件、镜像和原数据库卷。
3. 创建新一代数据库卷，导入快照，再执行产品原生迁移。上一个数据库卷保持在更新前的状态。
4. 启动新版本，执行所有就绪/OAuth 检查和真实浏览器彩排。只有通过后才写入 `config/sources.json`。
5. 构建失败时旧服务保持在线；切换、迁移或彩排失败时自动恢复上一版。新版本与失败材料会保留供排查。

不重新生成账号、密码、MFA 或 OAuth 密钥，不清空订阅，不自动运行会删除数据的市场种子脚本。邮箱通过独立 named volume 保留。完整彩排会登录演示身份，并保留/复用 POP 免费订阅。

同一时间只允许一个更改环境的命令执行，避免更新、重建、停止和播种互相覆盖。可以同时运行 `versions`、`status` 或查看日志。

## 回退

```bash
scripts/demo rollback
```

恢复最近一次成功更新/重建之前的源代码、镜像、配置和数据库卷，并重新运行健康检查及浏览器彩排。它恢复的是更新前的数据时点；新版本运行后产生的数据留在被替换的卷中，不进行数据库结构降级或删除新卷。

回退材料保存在 `.local/releases/<代次>/`：

- `state.json`：前后提交、镜像 ID、数据库卷名和验证状态。
- `previous/`：上个版本的源码、构建和 SSO 私有配置。
- `database.sql`：切换时的私有数据库快照。
- `rehearsal.json` / `rollback-rehearsal.json`：成功切换或回退的彩排结果。
- `failed/` 或 `replaced/`：被恢复操作替换的版本。
- `failure.txt`：有异常时保存的私有诊断信息。

这些目录可能包含凭证和业务数据，已被 Git 忽略。保留目录、镜像和数据库卷供演示前回退使用；不要在演示期间自行 prune 它们。如果恢复过程也失败，命令会报错并指明保留目录，需先检查该次 `state.json` 和私有日志。

## 上游变更边界

新增的正常数据库迁移会对新卷执行，不会修改保留的旧卷。上游如果改变服务名称、端口、OAuth 合同或本地部署结构，可能需要更新本项目的适配逻辑；兼容性检查失败时保留旧环境。

第一次构建所用的 Mac、旧版 Docker/Compose 兼容处理见 [本机兼容记录](local-compatibility.md)。Go 工具链版本从候选 SSO 的 `go.mod` 读取。故障注入验证可运行：

```bash
python3 -m unittest discover -s tests -p 'test_releases.py'
```
