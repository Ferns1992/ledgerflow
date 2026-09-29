# syntax=docker/dockerfile:1

# --- Build stage -------------------------------------------------------------
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# better-sqlite3 compiles a native addon when no prebuilt binary matches the
# platform, so the build stage needs a toolchain. It is not carried into the
# runtime image.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install with dev dependencies so vite and tsc are available to build.
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json tsconfig.server.json vite.config.ts index.html ./
COPY src ./src
COPY server.ts ./
COPY scripts ./scripts

RUN npm run build

# --- Runtime stage -----------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

WORKDIR /app

# curl is only here for the container healthcheck.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/accounting.db

# Production dependencies only. better-sqlite3 ships a prebuilt binary for
# node 22 on linux/x64 and arm64, so no compiler is needed here.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund \
  && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server

# Run as an unprivileged user. node:22 images ship one already.
RUN mkdir -p /app/data /app/backups && chown -R node:node /app/data /app/backups
USER node

EXPOSE 3000

# The healthcheck deliberately goes over the container's own IP rather than
# loopback: a loopback probe passes even when the server has bound only to
# 127.0.0.1, which is the one configuration that looks healthy from inside and
# is unreachable from outside.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS "http://$(hostname -i | awk '{print $1}'):${PORT}/api/health" || exit 1

CMD ["node", "dist-server/server.js"]
