# syntax=docker/dockerfile:1.7
# MarketStars - Next.js 15 (output: "standalone") production image.
# Build:  docker build -t marketstars:local .
# Run:    docker run -p 3000:3000 --env-file .env marketstars:local
# Migrate (same image): prisma migrate deploy --schema=prisma/schema.prisma

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base
# openssl is required by Prisma engines (debian-openssl-3.0.x).
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    CHECKPOINT_DISABLE=1

# ---- deps: install all dependencies (incl. dev, needed for build) ----
FROM base AS deps
COPY package.json package-lock.json ./
# prisma/ is copied so that a postinstall "prisma generate" (if any) works.
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

# ---- builder: prisma generate + next build ----
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Dummy build-time values only (never real secrets). Runtime values come from
# the ConfigMap / Secret in Kubernetes.
ENV DATABASE_URL=mysql://build:build@localhost:3306/build \
    APP_BASE_URL=http://localhost:3000 \
    SESSION_SECRET=build-only-dummy-session-secret-0000000000 \
    AUTH_MODE=demo \
    NODE_ENV=production
RUN mkdir -p public \
 && npx prisma generate \
 && npm run build
# Self-contained Prisma CLI (same version as the app) with its full dependency
# tree, so `prisma migrate deploy` works in the slim runtime image without npx
# downloading anything at runtime.
RUN PRISMA_VERSION="$(node -p "require('prisma/package.json').version")" \
 && mkdir -p /opt/prisma-cli && cd /opt/prisma-cli \
 && npm init -y >/dev/null \
 && npm install --no-audit --no-fund --omit=dev "prisma@${PRISMA_VERSION}"

# ---- runner: minimal runtime, non-root ----
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    PATH=/opt/prisma-cli/node_modules/.bin:$PATH
# Files are owned by root and read-only for the runtime user; only the Next.js
# cache directory is writable (mounted as emptyDir in Kubernetes).
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/api ./api
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /opt/prisma-cli /opt/prisma-cli
RUN mkdir -p .next/cache && chown 1000:1000 .next/cache
# uid/gid 1000 = "node" user of the official image (numeric for runAsNonRoot).
USER 1000:1000
EXPOSE 3000
CMD ["node", "server.js"]
