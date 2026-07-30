# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# agentistics — multi-stage Docker build
#
# Stage 1 (builder): oven/bun — installs deps, builds web assets, embeds them.
# Stage 2 (runner):  oven/bun — minimal runtime image, SERVE_STATIC=1.
# ---------------------------------------------------------------------------

# ---- Stage 1: build -------------------------------------------------------
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy workspace manifests first for layer-cache efficiency
COPY package.json bun.lock ./
COPY packages/core/package.json      ./packages/core/
COPY packages/server/package.json    ./packages/server/
COPY packages/web/package.json       ./packages/web/
COPY packages/mcp/package.json       ./packages/mcp/
COPY packages/desktop/package.json   ./packages/desktop/

RUN bun install --frozen-lockfile

# Copy the full source
COPY . .

# Build web assets (Vite → packages/web/dist)
RUN bun run build

# Embed web assets into a TypeScript module that the server imports at runtime.
# This generates packages/server/server/embedded-dist.generated.ts
RUN bun run build:assets

# ---- Stage 2: runtime -----------------------------------------------------
FROM oven/bun:1-slim AS runner

WORKDIR /app

# The TLS trust store, installed EXPLICITLY rather than inherited from the base image.
#
# A central talks to Mongo over TLS (Atlas is `mongodb+srv://…`, certificate-verified). The base
# image happened to ship a usable trust store, so this worked — until a rebuild pulled a newer
# `oven/bun:1-slim` whose store differed, and every Mongo connection began failing with
# "Cert does not contain a DNS name". Same code, same Dockerfile, same commit: only the
# unpinned base had moved. The app served its static assets fine and 500'd on every route that
# touched the database, which reads as data loss rather than as a TLS fault.
#
# Depending on a base image for the trust store is depending on something nobody pinned. Install
# it here so a rebuild cannot silently take it away.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Copy workspace manifests + lock
COPY package.json bun.lock ./
COPY packages/core/package.json      ./packages/core/
COPY packages/server/package.json    ./packages/server/
COPY packages/web/package.json       ./packages/web/
COPY packages/mcp/package.json       ./packages/mcp/
COPY packages/desktop/package.json   ./packages/desktop/

# Production deps only (no devDependencies). --ignore-scripts skips the root
# `prepare: husky` lifecycle (husky is a devDependency, absent in --production,
# and git hooks are irrelevant in the runtime image).
RUN bun install --frozen-lockfile --production --ignore-scripts

# Copy built source + generated embed
COPY --from=builder /app/packages ./packages

# agentistics runs on port 47291; expose it
EXPOSE 47291

# Run unprivileged. The app only ever reads its own code and writes /data, so root buys
# nothing and costs everything if a process is ever compromised. HOME=/data because the
# server resolves its writable data dir (~/.agentistics) from it.
# groupadd/useradd (passwd), not addgroup/adduser: the bun runtime image is
# debian-slim, which ships passwd but NOT the adduser package.
RUN groupadd --system --gid 10001 agentistics \
 && useradd  --system --uid 10001 --gid agentistics --home-dir /data --shell /usr/sbin/nologin agentistics \
 && mkdir -p /data/.agentistics \
 && chown -R agentistics:agentistics /data /app
USER agentistics

# SERVE_STATIC=1: server.ts will serve the embedded frontend on the same port.
# AGENTISTICS_TEAM_CENTRAL=1: activate central aggregator mode.
ENV SERVE_STATIC=1 \
    AGENTISTICS_TEAM_CENTRAL=1 \
    PORT=47291 \
    HOME=/data

CMD ["bun", "run", "packages/server/server/index.ts"]
