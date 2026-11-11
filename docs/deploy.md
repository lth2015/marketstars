# MarketStars 部署手册

相关文件：

- `Dockerfile` / `.dockerignore`：多阶段构建，运行时为非 root（uid 1000）的 Next.js standalone 镜像，内置 Prisma CLI 用于迁移。
- `deploy/k8s/base`：Kustomize 基础清单（Deployment + Cloud SQL Auth Proxy 原生 sidecar、Service、Gateway、HTTPRoute、HealthCheckPolicy、GCPBackendPolicy、PDB、HPA、CronJob、迁移 Job、ConfigMap、ExternalSecret）。
- `deploy/k8s/overlays/{dev,staging,production}`：各环境差异（域名、副本数、镜像 tag、AUTH_MODE 等）。
- `deploy/gcp/README.md`：GCP 基础设施一次性搭建步骤（Artifact Registry、GKE Autopilot、Cloud SQL、Secret Manager、Workload Identity、Cloud Armor、GCS、监控告警）。
- `.github/workflows/ci.yml`：CI（lint/typecheck/test/build、清单校验）与手动触发的部署 Job 骨架。

## 1. 环境分离

| 环境 | GCP 项目 | 域名 | AUTH_MODE | HPA 副本 | 说明 |
|------|----------|------|-----------|----------|------|
| dev | `marketstars-dev` | `dev.marketstars.example.com` | `demo`（仅 dev 允许） | 1–2 | 建议 Cloud Armor 仅放行办公/VPN IP |
| staging | `marketstars-stg` | `staging.marketstars.example.com` | `oidc` | 2–4 | 与生产同构，用于发布前验证与恢复演练 |
| production | `marketstars-prod` | `marketstars.example.com` | `oidc`（强制，CI 校验） | 3–10 | GitHub Environment 需审批 |

- 每个环境独立 GCP 项目 / GKE 集群 / Cloud SQL / Secret Manager / Cloud Armor / GCS bucket，IAM 与数据完全隔离；项目内资源同名，overlay 只改差异项。
- 镜像统一构建到共享项目的 Artifact Registry，同一镜像（同一 git sha）按 dev → staging → production 晋级，不在各环境重复构建。
- 密钥只存在于 Secret Manager，通过 External Secrets Operator（`external-secrets.io/v1`）同步为 K8s Secret `marketstars-secrets`；仓库中不提交任何真实值。
- SSO（`lth2015/sso`）独立部署在自己的域名，MarketStars 每个环境在 SSO 中注册独立的 OIDC client（`marketstars-<env>`）。

## 2. 部署流程

前提：已按 `deploy/gcp/README.md` 完成基础设施，并已 `gcloud container clusters get-credentials`。

```bash
export ENV=staging
export REG=asia-northeast1-docker.pkg.dev/marketstars-shared/marketstars/app
export TAG=$(git rev-parse --short=12 HEAD)
OV=deploy/k8s/overlays/$ENV
```

### 2.1 构建镜像 → 推送

```bash
gcloud auth configure-docker asia-northeast1-docker.pkg.dev
docker build -t $REG:$TAG .
docker push $REG:$TAG
```

### 2.2 设置镜像 tag

```bash
(cd $OV && kustomize edit set image marketstars=$REG:$TAG)
kubectl kustomize $OV | grep -E 'image:|AUTH_MODE'   # 确认
```

### 2.3 前置资源（Namespace / SA / ConfigMap / ExternalSecret / Service / Gateway 等）

```bash
kubectl apply -k $OV -l marketstars.io/phase=prereq
kubectl -n marketstars wait --for=condition=Ready externalsecret/marketstars-secrets --timeout=2m
```

### 2.4 迁移 Job（`prisma migrate deploy`，先于应用发布）

```bash
kubectl -n marketstars delete job marketstars-migrate --ignore-not-found   # Job 不可变，先删旧的
kubectl apply -k $OV -l marketstars.io/phase=migrate
kubectl -n marketstars wait --for=condition=complete job/marketstars-migrate --timeout=15m \
  || { kubectl -n marketstars logs job/marketstars-migrate -c migrate; exit 1; }
```

迁移失败则停止发布，不进入下一步（旧版本应用继续服务）。

### 2.5 滚动发布

```bash
kubectl apply -k $OV -l marketstars.io/phase=app
kubectl -n marketstars rollout status deploy/marketstars --timeout=10m
kubectl -n marketstars get pods,hpa,pdb
```

滚动策略 `maxSurge: 1 / maxUnavailable: 0`：新 Pod 通过 readiness（`/api/readyz`，含 DB 检查）后才替换旧 Pod；`preStop sleep 20` + LB connection draining 30s 保证无损下线；PDB `maxUnavailable: 1` 防止节点维护时同时驱逐。

### 2.6 发布后验证

```bash
curl -fsS https://$DOMAIN/api/healthz
curl -fsS https://$DOMAIN/api/readyz
kubectl -n marketstars get cronjob marketstars-jobs
kubectl -n marketstars create job --from=cronjob/marketstars-jobs jobs-manual-$(date +%s)   # 手动跑一次定时任务
```

也可在 GitHub Actions 中手动触发 `CI` workflow 的 `deploy`（`workflow_dispatch`，选择环境），其步骤与上面一致。

## 3. 回滚

### 3.1 应用回滚

方式 A：K8s 历史版本（最快，`revisionHistoryLimit: 10`）

```bash
kubectl -n marketstars rollout history deploy/marketstars
kubectl -n marketstars rollout undo deploy/marketstars                 # 回到上一版本
kubectl -n marketstars rollout undo deploy/marketstars --to-revision=N
kubectl -n marketstars rollout status deploy/marketstars
```

方式 B：回退镜像 tag（推荐作为最终状态，保证 Git 与集群一致）

```bash
(cd $OV && kustomize edit set image marketstars=$REG:<上一个稳定 tag>)
kubectl apply -k $OV -l marketstars.io/phase=prereq
kubectl apply -k $OV -l marketstars.io/phase=app      # 不要再执行迁移 Job
kubectl -n marketstars rollout status deploy/marketstars
```

注意：方式 A 之后，下次 `kubectl apply -k` 会以 overlay 中的 tag 为准，必须同步把 overlay 改回稳定 tag（方式 B）。

### 3.2 数据库：迁移只前向（forward-only）

- 不执行 `prisma migrate reset` / 手写 down 迁移。所有 schema 变更采用 expand → migrate → contract：
  1. 先发布"兼容新旧代码"的扩展迁移（加列/加表，新列可空或有默认值）；
  2. 再发布使用新结构的代码；
  3. 确认无需回滚后，下一个版本再删除旧列/旧表。
- 因此应用回滚到上一版本时，数据库保持新 schema 仍可工作，无需回退数据库。
- 如迁移本身有缺陷：编写新的修复迁移前向修正；只有数据损坏时才用备份/PITR 恢复。

### 3.3 备份 / PITR 恢复（演练步骤，建议每季度在 staging 执行一次）

Cloud SQL 配置：每日自动备份保留 14 份，binlog 保留 7 天（PITR），区域级 HA。

```bash
export PROJECT_ID=marketstars-stg
gcloud sql backups list --instance=marketstars-db --project=$PROJECT_ID

# A. PITR：克隆到指定时间点（UTC），不影响原实例
gcloud sql instances clone marketstars-db marketstars-db-restore-$(date +%Y%m%d) \
  --point-in-time='2026-11-11T03:00:00.000Z' --project=$PROJECT_ID

# B. 从某个备份恢复到新实例
gcloud sql instances create marketstars-db-restore --database-version=MYSQL_8_0 --edition=enterprise \
  --tier=db-custom-2-7680 --region=asia-northeast1 --no-assign-ip \
  --network=projects/$PROJECT_ID/global/networks/default --project=$PROJECT_ID
gcloud sql backups restore <BACKUP_ID> --restore-instance=marketstars-db-restore \
  --backup-instance=marketstars-db --project=$PROJECT_ID
```

演练验证与切换：

1. 用 Cloud SQL Studio 或临时 Pod（带 proxy）连接恢复实例，核对关键表行数、最新数据时间点、`_prisma_migrations` 记录。
2. 如需真正切换：把 ConfigMap 中 `CLOUD_SQL_INSTANCE` 改为恢复实例（overlay `configMapGenerator`），必要时更新 Secret Manager 中 `marketstars-database-url`，然后 `kubectl apply -k`（ConfigMap hash 变化会触发滚动重启）。
3. 记录 RTO / RPO（目标：RPO ≤ 5 分钟（PITR），RTO ≤ 1 小时），演练结束后删除临时实例：`gcloud sql instances delete marketstars-db-restore-...`。

## 4. 验收项 A15 检查清单

以生产为例（`DOMAIN=marketstars.example.com`，`IP=$(gcloud compute addresses describe marketstars-ip --global --format='value(address)')`）。

**HTTPS / 证书**

- [ ] 证书为 Google 托管且 ACTIVE：`gcloud certificate-manager certificates describe marketstars-cert --format='value(managed.state)'` → `ACTIVE`
- [ ] HTTPS 正常：`curl -sSI https://$DOMAIN/ | head -1` → `HTTP/2 200`
- [ ] HTTP 跳转 HTTPS：`curl -sSI http://$DOMAIN/ | grep -iE '^(HTTP|location)'` → `301` + `location: https://...`
- [ ] TLS 版本/证书链：`openssl s_client -connect $DOMAIN:443 -servername $DOMAIN </dev/null 2>/dev/null | openssl x509 -noout -issuer -dates`

**内部端点 / 端口不可公网访问**

- [ ] 公网访问内部接口被拒（Cloud Armor 404 或重定向，绝不能到达应用）：
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' -X POST https://$DOMAIN/api/internal/jobs/run            # 期望 404
  curl -s -o /dev/null -w '%{http_code}\n' -X POST https://$DOMAIN/api/internal/jobs/run \
       -H "Authorization: Bearer dummy"                                                           # 期望 404
  curl -s -o /dev/null -w '%{http_code}\n' -X POST "https://$DOMAIN/api/%69nternal/jobs/run"      # 编码绕过，期望 404
  curl -s -o /dev/null -w '%{http_code}\n' -X POST "https://$DOMAIN/API/INTERNAL/jobs/run"        # 大小写，期望 404
  ```
- [ ] LB 只暴露 80/443：`nmap -Pn -p 1-65535 --open $IP`（或 `nc -vz -w3 $IP 3000; nc -vz -w3 $IP 3306; nc -vz -w3 $IP 9090` 均失败）
- [ ] Service 为 ClusterIP，无 LoadBalancer/NodePort：`kubectl get svc -A -o wide | grep -E 'LoadBalancer|NodePort'` → 无 marketstars 相关结果
- [ ] 节点无公网 IP（private nodes）：`gcloud compute instances list --filter='name~gk3-' --format='value(networkInterfaces[0].accessConfigs)'` → 空
- [ ] Cloud SQL 无公网 IP：`gcloud sql instances describe marketstars-db --format='value(ipAddresses)'` → 仅 `PRIVATE`
- [ ] HTTPRoute 中没有 `/api/internal` 的后端：`kubectl -n marketstars get httproute marketstars -o yaml | grep -A6 /api/internal` → 只有 RequestRedirect
- [ ] 集群内定时任务可用（经 ClusterIP）：`kubectl -n marketstars create job --from=cronjob/marketstars-jobs a15-check && kubectl -n marketstars logs -f job/a15-check` → 成功
- [ ] 无 token 时内部接口拒绝（集群内）：
  ```bash
  kubectl -n marketstars run a15-curl --rm -i --restart=Never --image=curlimages/curl:8.10.1 -- \
    curl -s -o /dev/null -w '%{http_code}\n' -X POST http://marketstars/api/internal/jobs/run     # 期望 401/403
  ```

**安全 / 防护**

- [ ] Cloud Armor 已挂载：`gcloud compute backend-services list --format='table(name,securityPolicy)'` → `marketstars-armor`
- [ ] 限流生效：`for i in $(seq 1 40); do curl -s -o /dev/null -w '%{http_code} ' https://$DOMAIN/auth/callback; done` → 后段出现 `429`
- [ ] 生产 `AUTH_MODE=oidc`：`kubectl -n marketstars get cm -l marketstars.io/phase=prereq -o yaml | grep AUTH_MODE`
- [ ] Pod 非 root、只读根文件系统：`kubectl -n marketstars get pod -l app.kubernetes.io/component=web -o jsonpath='{.items[0].spec.securityContext}'`
- [ ] 仓库中无真实密钥：`git grep -nE '(BEGIN .*PRIVATE KEY|mysql://[^u][^:]*:[^@]{8,}@)'` → 无结果

**可用性 / 运维**

- [ ] 副本 ≥ 2 且跨可用区：`kubectl -n marketstars get pods -o wide -l app.kubernetes.io/component=web`
- [ ] PDB / HPA 存在：`kubectl -n marketstars get pdb,hpa`
- [ ] 探针：`kubectl -n marketstars describe deploy marketstars | grep -E 'Liveness|Readiness|Startup'`
- [ ] 无损滚动：发布期间 `while true; do curl -s -o /dev/null -w '%{http_code}\n' https://$DOMAIN/api/healthz; sleep 0.2; done | sort | uniq -c` 无非 200
- [ ] Cloud SQL：`gcloud sql instances describe marketstars-db --format='value(settings.availabilityType,settings.backupConfiguration.enabled,settings.backupConfiguration.binaryLogEnabled)'` → `REGIONAL True True`
- [ ] 告警策略存在：`gcloud monitoring policies list --format='value(displayName)'`（5xx、延迟、Cloud SQL 连接数、Job 失败、SSO 回调失败）
- [ ] 日志指标：`gcloud logging metrics list --format='value(name)'` → `marketstars_sso_callback_failed`、`marketstars_job_failed`
- [ ] 回滚演练：执行一次 `kubectl rollout undo` 并恢复；staging 完成一次 PITR 克隆演练并记录 RTO/RPO
