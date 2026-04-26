# syntax=docker/dockerfile:1
# Build context: REPO ROOT (not admin/). Set Railway's rootDirectory to "/"
# and dockerfilePath to "admin/Dockerfile".

FROM node:20-alpine AS builder

WORKDIR /app

ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# Workspace manifests for cache-friendly install
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY admin/package.json ./admin/
COPY shared/package.json ./shared/

RUN npm ci

# Source for the workspaces admin depends on
COPY shared ./shared
COPY admin ./admin

RUN npm run build -w @cardioplace/shared
RUN npm run build -w admin

# ── Production image ──────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

# Next.js standalone output (with outputFileTracingRoot=monorepo root) lays out
# files mirroring the monorepo, so /app/admin/server.js is the entrypoint.
COPY --from=builder /app/admin/.next/standalone ./
COPY --from=builder /app/admin/.next/static ./admin/.next/static
COPY --from=builder /app/admin/public ./admin/public

EXPOSE 3001

WORKDIR /app/admin
CMD ["node", "server.js"]
