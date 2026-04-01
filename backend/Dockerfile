FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Production image ──────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# tsx + dotenv needed by prisma.config.ts for migrate deploy
RUN npm install --no-save tsx dotenv

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/proto ./proto
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts

EXPOSE 8080

CMD ["node", "dist/main.js"]
