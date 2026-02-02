# ============== Stage 1: Build ==============
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies (including devDependencies for build)
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# ============== Stage 2: Production ==============
FROM node:20-alpine AS production

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001 -G nodejs

# Copy only production dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built output from builder
COPY --from=builder /app/dist ./dist

# Own the app directory
RUN chown -R nestjs:nodejs /app

USER nestjs

EXPOSE 3000

CMD ["node", "dist/main.js"]
