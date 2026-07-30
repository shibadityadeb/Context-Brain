# syntax=docker/dockerfile:1
#
# One image for every Node service in the monorepo (api, web, and the four
# workers). Each compose service runs the same image with a different start
# command (`pnpm --filter <pkg> start`). Debian slim (not Alpine) so Prisma's
# and sharp's prebuilt native binaries resolve without musl gymnastics.
#
# The web app bakes NEXT_PUBLIC_API_URL at build time, so it is a build arg:
#   docker build --build-arg NEXT_PUBLIC_API_URL=https://api.example.com .

# ── Build stage: install deps, generate Prisma client, build all packages ────
FROM node:22-slim AS build
WORKDIR /app

# corepack pins the pnpm version from package.json#packageManager.
RUN corepack enable
# openssl: Prisma engines. python3/make/g++: node-gyp fallback for native deps.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# The public URL the browser uses to reach the API — baked into the web bundle.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

# Copy the whole workspace (host node_modules/dist/.next are excluded via
# .dockerignore) and install against the frozen lockfile.
COPY . .
RUN pnpm install --frozen-lockfile

# Prisma client for the container platform, then build every package
# (topological order; ui/types build before the web bundle).
RUN pnpm --filter @company-brain/api db:generate
RUN pnpm -r build

# ── Runtime stage: slim image carrying the fully built workspace ─────────────
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable \
  && apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

# Bring over the built workspace incl. node_modules (pnpm's relative symlinks
# survive the copy since paths are identical).
COPY --from=build /app /app

# api :4000 · web :3000 · temporal-worker :4100 · connector-worker :4101 ·
# meeting-worker :4102
EXPOSE 3000 4000 4100 4101 4102

# Default command; every compose service overrides this with its own filter.
CMD ["pnpm", "--filter", "@company-brain/api", "start"]
