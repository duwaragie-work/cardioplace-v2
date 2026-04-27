# syntax=docker/dockerfile:1
# Build context: REPO ROOT (not backend/). Set Railway's rootDirectory to "/"
# and dockerfilePath to "backend/Dockerfile".

FROM node:20-slim AS builder

WORKDIR /app

ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip

# OpenSSL + ca-certs needed by Prisma's CLI/engine on slim base image
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Workspace manifests for cache-friendly install
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY admin/package.json ./admin/
COPY shared/package.json ./shared/

RUN npm ci

# Source for the workspaces backend depends on
COPY shared ./shared
COPY backend ./backend

# Backend's prebuild handles `npm run build:shared` + `prisma generate`
RUN npm run build -w healplace-v2-backend

# ── Production image ──────────────────────────────────────────────────────────
FROM node:20-slim

WORKDIR /app

ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip
ENV NODE_ENV=production

# OpenSSL + ca-certs needed by Prisma at runtime on slim base image
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY admin/package.json ./admin/
COPY shared/package.json ./shared/

RUN npm ci --omit=dev

# Runtime tools for `prisma migrate deploy` (prisma + tsx are devDeps in backend)
RUN npm install --no-save --workspaces=false tsx prisma

# Built outputs
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/proto ./backend/proto

# Prisma schema + config required for `prisma migrate deploy` at startup
COPY backend/prisma ./backend/prisma
COPY backend/prisma.config.ts ./backend/prisma.config.ts

WORKDIR /app/backend

EXPOSE 8080

CMD ["node", "dist/main.js"]
