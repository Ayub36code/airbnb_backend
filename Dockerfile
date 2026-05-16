# ══════════════════════════════════════════════
# Stage 1: Builder
# ══════════════════════════════════════════════
FROM node:20-alpine AS builder

RUN apk add --no-cache python3 make g++ libc6-compat

WORKDIR /app

# Copy package files first for layer caching
COPY package*.json ./
COPY tsconfig*.json ./

RUN npm ci --include=dev

# Copy source
COPY prisma ./prisma/
COPY src ./src/

# Generate Prisma client
RUN npx prisma generate

# Build application
RUN npm run build

# ══════════════════════════════════════════════
# Stage 2: Production
# ══════════════════════════════════════════════
FROM node:20-alpine AS production

RUN apk add --no-cache curl tini

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001

# Copy production node_modules
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built app and Prisma artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY prisma ./prisma/

# Copy templates if any
COPY src/templates ./templates

# Set ownership
RUN chown -R nestjs:nodejs /app
USER nestjs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3000/api/v1/health/live || exit 1

EXPOSE 3000

# Use tini as init system
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main"]
