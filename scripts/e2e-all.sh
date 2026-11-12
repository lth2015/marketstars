#!/usr/bin/env bash
# 依次运行全部端到端验收。前提：DATABASE_URL 指向测试库、已 migrate、已 build，
# demo 模式的 MarketStars 已在 BASE（默认 http://localhost:3000）运行。每套测试前重新 seed 并执行一次定时任务。
set -uo pipefail
BASE=${BASE:-http://localhost:3000}
JOB_TOKEN=${JOB_TOKEN:-local-job-token}
fail=0
for suite in e2e e2e-p1 e2e-p2 e2e-p3 e2e-p4 e2e-p5 e2e-p6 e2e-p7 e2e-p8 e2e-p9 e2e-p10 e2e-p11 e2e-p12 e2e-p13 e2e-oidc; do
  npx tsx prisma/seed.ts >/dev/null
  curl -fsS -X POST -H "Authorization: Bearer $JOB_TOKEN" "$BASE/api/internal/jobs/run" >/dev/null
  echo "== $suite"
  node "tests/$suite.mjs" || fail=1
done
exit $fail
