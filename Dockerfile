# ==============================================================================
# XONIT Backend Multi-Stage Production Dockerfile
# ==============================================================================

# Stage 1: Build stage
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache openssl libc6-compat

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install --legacy-peer-deps

COPY tsconfig.json ./
COPY src ./src/

RUN npx prisma generate
RUN npm run build

# Stage 2: Production Runner
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

RUN apk add --no-cache openssl libc6-compat curl

# Non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 xonit

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install --omit=dev --legacy-peer-deps
RUN npx prisma generate

COPY --from=builder --chown=xonit:nodejs /app/dist ./dist

USER xonit

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:5000/health || exit 1

CMD ["node", "dist/src/index.js"]
