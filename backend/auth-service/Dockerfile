# syntax=docker/dockerfile:1

# ---------- Stage 1: base ----------
FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat

# ---------- Stage 2: dependencies ----------
FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci

# ---------- Stage 3: build (generate Prisma client, drop dev deps) ----------
FROM dependencies AS build
COPY prisma ./prisma
COPY prisma.config.mjs ./
RUN npx prisma generate
COPY src ./src
COPY docs ./docs
COPY server.js ./
RUN npm prune --omit=dev

# ---------- Stage 4: runtime (distroless-style, non-root) ----------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build --chown=node:node /app ./

USER node
EXPOSE 5001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5001)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
