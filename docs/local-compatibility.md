# 本机兼容处理记录

本项目在独立副本运行 Marketstars 与 SSO，原开发目录没有检出或工作区修改。所有本地适配由 `scripts/demo.py` 生成并局限在当前项目。

## Docker Desktop 代理阻塞

现象：原有容器正常，新容器保持 Created。经过桌面代理的 `POST /containers/{owned-demo-container}/start` 在 3 秒内无响应；无 bind mount 的最小测试容器经引擎 socket 启动返回 HTTP 204（约 0.2 秒）。含新增宿主机目录挂载的容器仍阻塞。后端日志定位到读取 Desktop settings 和批准目录挂载的路径。

处理：当前项目专用 DOCKER_HOST 指向这台 Mac 的 `~/Library/Containers/com.docker.docker/Data/docker.raw.sock`。不重启引擎，不修改全局配置。Hydra 配置复制进本地镜像；MySQL 初始化 SQL 经 exec 导入；邮箱使用专用 named volume，并由私有后台进程复制到本项目邮箱目录。实际新 MySQL 启动、宿主机握手、SQL 查询及所有 SSO 服务已通过。启动检查使用完整实际服务作为回归验证，不把最小测试成功当作联调成功。

## Compose 2.2 配置兼容

- 删除不受支持的顶层 `name`，通过 `COMPOSE_PROJECT_NAME=marketplace-local-demo` 设置独立项目名。
- 原配置把 JSON 中间的变量插入到 Hydra token hook 环境变量时，容器内实际 JSON 在密钥末尾被截断，Hydra 报 token_hook 配置无效。将完整 JSON 作为一个环境变量传入后，容器内 JSON 可解析，Hydra 就绪探针返回 200，真实 OAuth 授权与业务 token 验证成功。
- MySQL 使用本机已有的 8.0.40 ARM64 镜像，数据和凭证均独立；未复用已有 x402 数据库。

## Mac 和端口

上游安装脚本固定 Linux AMD64。本项目调用校验工具链 Go 1.27.3，在 Mac 交叉编译当前 Docker 的 Linux ARM64 服务。公开 origin 和宿主机映射使用 13000/13001/13002/13003、18080/18083、14464/14465；保留容器内部监听和网络边界。

Node 专用 DNS preload 将 localhost 及其子域解析至 127.0.0.1，不修改 hosts。所有 npm/Go/Chrome 工具和路径已在本机验证；此项目没有宣称支持其他操作系统。
