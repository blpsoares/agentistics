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

# SERVE_STATIC=1: server.ts will serve the embedded frontend on the same port.
# AGENTISTICS_TEAM_CENTRAL=1: activate central aggregator mode.
ENV SERVE_STATIC=1 \
    AGENTISTICS_TEAM_CENTRAL=1 \
    PORT=47291

CMD ["bun", "run", "packages/server/server/index.ts"]
