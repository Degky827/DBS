# syntax=docker/dockerfile:1

# ---------- Stage 1: base ----------
FROM node:22-alpine AS base
WORKDIR /app

# ---------- Stage 2: dependencies ----------
FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------- Stage 3: build (generate Prisma client, drop dev deps) ----------
FROM dependencies AS build
COPY prisma ./prisma
COPY prisma.config.mjs ./
RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" npx prisma generate
COPY src ./src
COPY server.js ./
RUN npm prune --omit=dev

# ---------- Stage 3b: migration runner (keeps the Prisma CLI) ----------
FROM dependencies AS migrate
COPY prisma ./prisma
COPY prisma.config.mjs ./
CMD ["npx", "prisma", "migrate", "deploy"]

# ---------- Stage 4: runtime (non-root) ----------
FROM base AS runtime
ENV NODE_ENV=production

COPY --from=build --chown=node:node /app ./
RUN mkdir -p /app/storage && chown -R node:node /app/storage

USER node
EXPOSE 5003

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5003)+'/api/v1/kyc/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
