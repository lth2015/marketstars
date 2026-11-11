# MarketStars on GCP — infrastructure setup

One-time (per environment) `gcloud` steps. Kubernetes manifests live in
`deploy/k8s/`, the release runbook (Chinese) in `docs/deploy.md`.

**Environment separation model:** each environment (`dev`, `staging`,
`production`) has its **own GCP project**, GKE Autopilot cluster, Cloud SQL
instance, Secret Manager secrets, Cloud Armor policy and bucket. Resource names
inside a project are identical (`marketstars-db`, `marketstars-armor`,
`marketstars-certmap`, ...), so the overlays only differ in project ID,
hostnames, scale and `AUTH_MODE`. Container images are built once into a
**shared** Artifact Registry project and promoted by tag/digest.

**Secrets:** External Secrets Operator (ESO) syncs Secret Manager secrets into
the `marketstars-secrets` Kubernetes Secret (`deploy/k8s/base/externalsecret.yaml`).
The ESO `SecretStore` authenticates with Workload Identity as the `marketstars`
KSA. No secret value is ever committed.

The identity provider (`lth2015/sso`) is deployed separately on its own domain;
here we only register MarketStars as an OIDC client there and configure its URLs.

---

## 0. Variables

```bash
export ENV=production                 # dev | staging | production
export PROJECT_ID=marketstars-prod    # marketstars-dev | marketstars-stg | marketstars-prod
export SHARED_PROJECT_ID=marketstars-shared   # Artifact Registry + CI
export REGION=asia-northeast1
export CLUSTER=$PROJECT_ID            # cluster name == project id (matches overlays)
export DOMAIN=marketstars.example.com # dev.marketstars.example.com / staging.marketstars.example.com
export NETWORK=default
export PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
gcloud config set project $PROJECT_ID

gcloud services enable container.googleapis.com sqladmin.googleapis.com \
  servicenetworking.googleapis.com secretmanager.googleapis.com \
  certificatemanager.googleapis.com compute.googleapis.com \
  monitoring.googleapis.com logging.googleapis.com storage.googleapis.com \
  artifactregistry.googleapis.com iamcredentials.googleapis.com
```

## 1. Artifact Registry (shared project, once)

```bash
gcloud artifacts repositories create marketstars --project=$SHARED_PROJECT_ID \
  --repository-format=docker --location=$REGION \
  --description="MarketStars images"

# Let each env's Autopilot nodes (default compute SA) pull images.
gcloud artifacts repositories add-iam-policy-binding marketstars \
  --project=$SHARED_PROJECT_ID --location=$REGION \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role=roles/artifactregistry.reader
```

Image: `asia-northeast1-docker.pkg.dev/$SHARED_PROJECT_ID/marketstars/app:<git-sha>`.

## 2. GKE Autopilot cluster with Gateway API

Autopilot always has Workload Identity enabled (pool `$PROJECT_ID.svc.id.goog`).

```bash
gcloud container clusters create-auto $CLUSTER --region=$REGION \
  --network=$NETWORK --release-channel=regular --enable-private-nodes

# Make sure the GKE Gateway controller + standard Gateway API CRDs are on.
gcloud container clusters update $CLUSTER --region=$REGION --gateway-api=standard

gcloud container clusters get-credentials $CLUSTER --region=$REGION
kubectl get gatewayclass   # expect gke-l7-global-external-managed

# External Secrets Operator (pin a version you have tested, >= v0.17 for external-secrets.io/v1)
helm repo add external-secrets https://charts.external-secrets.io
helm upgrade --install external-secrets external-secrets/external-secrets \
  -n external-secrets --create-namespace --set installCRDs=true
```

Private nodes need Cloud NAT only if pods call the Internet (e.g. the SSO
issuer on its public domain — they do):

```bash
gcloud compute routers create marketstars-router --network=$NETWORK --region=$REGION
gcloud compute routers nats create marketstars-nat --router=marketstars-router \
  --region=$REGION --auto-allocate-nat-external-ips --nat-all-subnet-ip-ranges
```

## 3. Cloud SQL for MySQL 8.0 (regional HA, backups, PITR, private IP)

```bash
# Private Services Access (once per VPC)
gcloud compute addresses create google-managed-services-$NETWORK --global \
  --purpose=VPC_PEERING --prefix-length=16 --network=$NETWORK
gcloud services vpc-peerings connect --service=servicenetworking.googleapis.com \
  --ranges=google-managed-services-$NETWORK --network=$NETWORK

gcloud sql instances create marketstars-db \
  --database-version=MYSQL_8_0 --edition=enterprise \
  --tier=db-custom-2-7680 --region=$REGION \
  --availability-type=REGIONAL \
  --network=projects/$PROJECT_ID/global/networks/$NETWORK --no-assign-ip \
  --storage-type=SSD --storage-size=20GB --storage-auto-increase \
  --backup-start-time=18:00 --retained-backups-count=14 \
  --enable-bin-log --retained-transaction-log-days=7 \
  --maintenance-window-day=SUN --maintenance-window-hour=19 \
  --database-flags=character_set_server=utf8mb4 \
  --deletion-protection
# dev may use --availability-type=ZONAL and a smaller tier to save cost.
```

`--enable-bin-log` + `--retained-transaction-log-days` enable point-in-time
recovery for MySQL. Backup time is UTC (18:00 UTC = 03:00 JST).

## 4. Database and user

```bash
gcloud sql databases create marketstars --instance=marketstars-db \
  --charset=utf8mb4 --collation=utf8mb4_unicode_ci

DB_PASSWORD=$(openssl rand -hex 24)        # hex => no URL-encoding issues
gcloud sql users create marketstars --instance=marketstars-db \
  --host=% --password="$DB_PASSWORD"
```

The app talks to the Cloud SQL Auth Proxy sidecar on `127.0.0.1:3306`, so:
`DATABASE_URL=mysql://marketstars:<password>@127.0.0.1:3306/marketstars`.

## 5. Secret Manager

Names are the same in every env project (see `externalsecret.yaml`).

```bash
put() { printf '%s' "$2" | gcloud secrets create "$1" --replication-policy=automatic --data-file=- \
        || printf '%s' "$2" | gcloud secrets versions add "$1" --data-file=-; }

put marketstars-database-url "mysql://marketstars:${DB_PASSWORD}@127.0.0.1:3306/marketstars"
put marketstars-session-secret "$(openssl rand -base64 48)"
put marketstars-job-token "$(openssl rand -hex 32)"
put marketstars-oidc-client-secret "<client secret issued by lth2015/sso for marketstars-$ENV>"
put marketstars-launch-client-secret-pop-writer "<value from SSO>"
put marketstars-payment-webhook-secret "<webhook signing secret from the payment provider>"
put marketstars-anthropic-api-key "<Anthropic API key for the model gateway>"
unset DB_PASSWORD
```

Rotation: add a new version; ESO refreshes hourly (`refreshInterval: 1h`), then
`kubectl -n marketstars rollout restart deploy/marketstars`.

## 6. GSA + Workload Identity

```bash
gcloud iam service-accounts create marketstars-app --display-name="MarketStars app"
GSA=marketstars-app@$PROJECT_ID.iam.gserviceaccount.com

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$GSA" --role=roles/cloudsql.client
for s in marketstars-database-url marketstars-session-secret marketstars-job-token \
         marketstars-oidc-client-secret marketstars-launch-client-secret-pop-writer \
         marketstars-payment-webhook-secret marketstars-anthropic-api-key; do
  gcloud secrets add-iam-policy-binding $s \
    --member="serviceAccount:$GSA" --role=roles/secretmanager.secretAccessor
done

# KSA marketstars/marketstars -> GSA (used by app pods, migration Job and ESO SecretStore)
gcloud iam service-accounts add-iam-policy-binding $GSA \
  --role=roles/iam.workloadIdentityUser \
  --member="serviceAccount:$PROJECT_ID.svc.id.goog[marketstars/marketstars]"
```

## 7. Static IP + Google-managed certificate (Certificate Manager)

```bash
gcloud compute addresses create marketstars-ip --global --ip-version=IPV4
gcloud compute addresses describe marketstars-ip --global --format='value(address)'
# -> create DNS A record  $DOMAIN -> <ip>

gcloud certificate-manager dns-authorizations create marketstars-dns-auth --domain=$DOMAIN
gcloud certificate-manager dns-authorizations describe marketstars-dns-auth \
  --format='value(dnsResourceRecord.name,dnsResourceRecord.type,dnsResourceRecord.data)'
# -> create that CNAME in DNS

gcloud certificate-manager certificates create marketstars-cert \
  --domains=$DOMAIN --dns-authorizations=marketstars-dns-auth
gcloud certificate-manager maps create marketstars-certmap
gcloud certificate-manager maps entries create marketstars-entry \
  --map=marketstars-certmap --certificates=marketstars-cert --hostname=$DOMAIN
```

The Gateway references these via `networking.gke.io/certmap: marketstars-certmap`
and `addresses: NamedAddress marketstars-ip`.

## 8. Cloud Armor (attached by GCPBackendPolicy `securityPolicy: marketstars-armor`)

```bash
P=marketstars-armor
gcloud compute security-policies create $P --type=CLOUD_ARMOR \
  --description="MarketStars edge policy"
gcloud compute security-policies update $P --enable-layer7-ddos-defense

# 100: never expose internal endpoints publicly (decoded + lowercased path)
gcloud compute security-policies rules create 100 --security-policy=$P \
  --expression="request.path.urlDecode().lower().startsWith('/api/internal')" \
  --action=deny-404 --description="block /api/internal/*"

# 900: stricter rate limit on auth endpoints (login/callback)
gcloud compute security-policies rules create 900 --security-policy=$P \
  --expression="request.path.startsWith('/auth/') || request.path.startsWith('/api/auth')" \
  --action=throttle --rate-limit-threshold-count=30 --rate-limit-threshold-interval-sec=60 \
  --conform-action=allow --exceed-action=deny-429 --enforce-on-key=IP

# 1000: global per-IP rate limit, temporary ban for abusive clients
gcloud compute security-policies rules create 1000 --security-policy=$P \
  --src-ip-ranges="*" --action=rate-based-ban \
  --rate-limit-threshold-count=600 --rate-limit-threshold-interval-sec=60 \
  --ban-threshold-count=3000 --ban-threshold-interval-sec=300 --ban-duration-sec=600 \
  --conform-action=allow --exceed-action=deny-429 --enforce-on-key=IP

# 2000/2001: OWASP preconfigured WAF rules, start in preview, enforce after tuning
gcloud compute security-policies rules create 2000 --security-policy=$P \
  --expression="evaluatePreconfiguredWaf('sqli-v33-stable', {'sensitivity': 1})" \
  --action=deny-403 --preview
gcloud compute security-policies rules create 2001 --security-policy=$P \
  --expression="evaluatePreconfiguredWaf('xss-v33-stable', {'sensitivity': 1})" \
  --action=deny-403 --preview
# Default rule (2147483647) stays "allow".
# dev only (recommended, since AUTH_MODE=demo): allowlist office/VPN IPs and set the default rule to deny-403.
```

## 9. Cloud Storage for public assets (icons / screenshots)

```bash
BUCKET=gs://$PROJECT_ID-marketstars-assets
gcloud storage buckets create $BUCKET --location=$REGION \
  --uniform-bucket-level-access --public-access-prevention=inherited
gcloud storage buckets add-iam-policy-binding $BUCKET \
  --member=allUsers --role=roles/storage.objectViewer          # public read
gcloud storage buckets add-iam-policy-binding $BUCKET \
  --member="serviceAccount:$GSA" --role=roles/storage.objectAdmin  # app uploads
cat > /tmp/cors.json <<EOF
[{"origin":["https://$DOMAIN"],"method":["GET","HEAD"],"responseHeader":["Content-Type"],"maxAgeSeconds":3600}]
EOF
gcloud storage buckets update $BUCKET --cors-file=/tmp/cors.json
```

Optional: put the bucket behind Cloud CDN (backend bucket) on an `assets.` subdomain.

## 10. Cloud Logging / Monitoring alerts

Log-based metrics:

```bash
gcloud logging metrics create marketstars_sso_callback_failed \
  --description="SSO callback failures" \
  --log-filter='resource.type="k8s_container" AND resource.labels.namespace_name="marketstars"
    AND resource.labels.container_name="app"
    AND (jsonPayload.message="auth.callback.failed" OR jsonPayload.msg="auth.callback.failed" OR textPayload:"auth.callback.failed")'

gcloud logging metrics create marketstars_job_failed \
  --description="Scheduled job (CronJob) failures" \
  --log-filter='(resource.type="k8s_container" AND resource.labels.namespace_name="marketstars"
      AND resource.labels.container_name="run-jobs" AND severity>=ERROR)
    OR (logName:"events" AND jsonPayload.involvedObject.namespace="marketstars"
      AND jsonPayload.reason=("BackoffLimitExceeded" OR "DeadlineExceeded"))'
```

Alert policies (create a notification channel first, e.g.
`gcloud beta monitoring channels create --display-name=oncall --type=email --channel-labels=email_address=oncall@example.com`):

| # | Policy | Metric / filter | Condition (start values; tune) |
|---|--------|-----------------|--------------------------------|
| 1 | LB 5xx rate | `loadbalancing.googleapis.com/https/request_count`, `response_code_class=500` ÷ all | > 2% for 5 min |
| 2 | LB latency | `loadbalancing.googleapis.com/https/total_latencies` p95 | > 1500 ms for 10 min |
| 3 | Cloud SQL connections | `cloudsql.googleapis.com/database/network/connections` | > 80% of `max_connections` for 5 min (also CPU > 80%, disk > 85%) |
| 4 | Job failures | `logging.googleapis.com/user/marketstars_job_failed` | > 0 within 20 min (2 consecutive runs) |
| 5 | SSO callback failures | `logging.googleapis.com/user/marketstars_sso_callback_failed` | > 10 in 5 min |
| + | Uptime | uptime check `https://$DOMAIN/api/healthz` | 2 regions failing |

Example (policy 1, ratio condition):

```bash
CHANNEL=projects/$PROJECT_ID/notificationChannels/<id>
cat > /tmp/lb-5xx.json <<EOF
{
  "displayName": "MarketStars LB 5xx > 2%",
  "combiner": "OR",
  "notificationChannels": ["$CHANNEL"],
  "conditions": [{
    "displayName": "5xx ratio",
    "conditionThreshold": {
      "filter": "resource.type=\"https_lb_rule\" AND metric.type=\"loadbalancing.googleapis.com/https/request_count\" AND metric.label.response_code_class=500",
      "denominatorFilter": "resource.type=\"https_lb_rule\" AND metric.type=\"loadbalancing.googleapis.com/https/request_count\"",
      "aggregations": [{"alignmentPeriod": "60s", "perSeriesAligner": "ALIGN_RATE", "crossSeriesReducer": "REDUCE_SUM"}],
      "denominatorAggregations": [{"alignmentPeriod": "60s", "perSeriesAligner": "ALIGN_RATE", "crossSeriesReducer": "REDUCE_SUM"}],
      "comparison": "COMPARISON_GT", "thresholdValue": 0.02, "duration": "300s"
    }
  }]
}
EOF
gcloud monitoring policies create --policy-from-file=/tmp/lb-5xx.json
```

Simple threshold policies (2–5) via flags, e.g.:

```bash
gcloud monitoring policies create --display-name="MarketStars SSO callback failures" \
  --notification-channels=$CHANNEL \
  --condition-display-name="auth.callback.failed > 10/5min" \
  --condition-filter='resource.type="k8s_container" AND metric.type="logging.googleapis.com/user/marketstars_sso_callback_failed"' \
  --aggregation='{"alignmentPeriod":"300s","perSeriesAligner":"ALIGN_SUM","crossSeriesReducer":"REDUCE_SUM"}' \
  --if='> 10' --duration=0s

gcloud monitoring uptime create marketstars-healthz --resource-type=uptime-url \
  --resource-labels=host=$DOMAIN,project_id=$PROJECT_ID \
  --protocol=https --path=/api/healthz --period=1
```

## 11. CI/CD: GitHub Actions Workload Identity Federation (shared project)

```bash
gcloud iam workload-identity-pools create github --project=$SHARED_PROJECT_ID --location=global
gcloud iam workload-identity-pools providers create-oidc github --project=$SHARED_PROJECT_ID \
  --location=global --workload-identity-pool=github \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping=google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref \
  --attribute-condition="assertion.repository=='<owner>/marketstars'"

gcloud iam service-accounts create gha-deployer --project=$SHARED_PROJECT_ID
DEPLOYER=gha-deployer@$SHARED_PROJECT_ID.iam.gserviceaccount.com
SHARED_NUMBER=$(gcloud projects describe $SHARED_PROJECT_ID --format='value(projectNumber)')
gcloud iam service-accounts add-iam-policy-binding $DEPLOYER --project=$SHARED_PROJECT_ID \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$SHARED_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/<owner>/marketstars"
gcloud artifacts repositories add-iam-policy-binding marketstars --project=$SHARED_PROJECT_ID \
  --location=$REGION --member="serviceAccount:$DEPLOYER" --role=roles/artifactregistry.writer
# per env project:
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$DEPLOYER" --role=roles/container.developer
```

Set GitHub **variables** (not secrets) per GitHub Environment: `GCP_WIF_PROVIDER`
(`projects/<SHARED_NUMBER>/locations/global/workloadIdentityPools/github/providers/github`),
`GCP_DEPLOY_SA`, `GCP_SHARED_PROJECT_ID`, `GCP_PROJECT_ID`, `GKE_CLUSTER`.
Protect the `production` environment with required reviewers.
