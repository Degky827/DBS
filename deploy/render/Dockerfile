# Consolidated image for Render's free tier.
#
# Render free web services cannot receive private-network traffic and share a
# single 750-hour monthly budget, so the five Compose containers (four Node
# services plus the Nginx SPA gateway) run as five processes inside one
# container. Each service keeps its own code, port, database and migrations.

ARG NODE_VERSION=22

# ---------- Auth service ----------
FROM node:${NODE_VERSION}-alpine AS auth-dependencies
WORKDIR /app/auth
COPY backend/auth-service/package.json backend/auth-service/package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM auth-dependencies AS auth-build
COPY backend/auth-service/prisma ./prisma
COPY backend/auth-service/prisma.config.mjs ./
RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" npx prisma generate
COPY backend/auth-service/src ./src
COPY backend/auth-service/docs ./docs
COPY backend/auth-service/server.js ./
RUN npm prune --omit=dev

# ---------- User service ----------
FROM node:${NODE_VERSION}-alpine AS user-dependencies
WORKDIR /app/user
COPY backend/user-service/package.json backend/user-service/package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM user-dependencies AS user-build
COPY backend/user-service/prisma ./prisma
COPY backend/user-service/prisma.config.mjs ./
RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" npx prisma generate
COPY backend/user-service/src ./src
COPY backend/user-service/docs ./docs
COPY backend/user-service/server.js ./
RUN npm prune --omit=dev

# ---------- KYC service ----------
FROM node:${NODE_VERSION}-alpine AS kyc-dependencies
WORKDIR /app/kyc
COPY backend/kyc-service/package.json backend/kyc-service/package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM kyc-dependencies AS kyc-build
COPY backend/kyc-service/prisma ./prisma
COPY backend/kyc-service/prisma.config.mjs ./
RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" npx prisma generate
COPY backend/kyc-service/src ./src
COPY backend/kyc-service/scripts ./scripts
COPY backend/kyc-service/server.js ./
RUN npm prune --omit=dev

# ---------- Notification service ----------
FROM node:${NODE_VERSION}-alpine AS notification-dependencies
WORKDIR /app/notification
COPY backend/notification-service/package.json backend/notification-service/package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM notification-dependencies AS notification-build
COPY backend/notification-service/prisma ./prisma
COPY backend/notification-service/prisma.config.mjs ./
RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" npx prisma generate
COPY backend/notification-service/src ./src
COPY backend/notification-service/server.js ./
RUN npm prune --omit=dev

# ---------- SPA ----------
FROM node:${NODE_VERSION}-alpine AS frontend-build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./

# Same-origin relative paths: the bundled Nginx gateway proxies them.
ARG VITE_AUTH_API=/api/auth
ARG VITE_USER_API=/api/user
ARG VITE_KYC_API=/api/kyc
ARG VITE_NOTIFICATION_API=/api/notifications
ENV VITE_AUTH_API=$VITE_AUTH_API
ENV VITE_USER_API=$VITE_USER_API
ENV VITE_KYC_API=$VITE_KYC_API
ENV VITE_NOTIFICATION_API=$VITE_NOTIFICATION_API
RUN npm run build

# ---------- Migration runner ----------
FROM node:${NODE_VERSION}-alpine AS migrator
WORKDIR /opt/migrator
COPY deploy/render/migrator/package.json deploy/render/migrator/package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------- Runtime ----------
FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# nginx is the only extra package; the Node runtime already provides fetch.
RUN apk add --no-cache nginx \
  && mkdir -p /tmp/nginx /var/lib/nginx/logs /var/lib/nginx/tmp \
  && chown -R node:node /tmp/nginx /var/lib/nginx /var/log/nginx

COPY --from=auth-build --chown=node:node /app/auth /app/services/auth
COPY --from=user-build --chown=node:node /app/user /app/services/user
COPY --from=kyc-build --chown=node:node /app/kyc /app/services/kyc
COPY --from=notification-build --chown=node:node /app/notification /app/services/notification
COPY --from=migrator --chown=node:node /opt/migrator /opt/migrator
COPY --from=frontend-build --chown=node:node /app/dist /var/www/spa
COPY --chown=node:node deploy/render/entrypoint.sh /app/entrypoint.sh
COPY --chown=node:node deploy/render/health.js /app/health.js
COPY --chown=node:node deploy/render/nginx /etc/nginx/banking
RUN chmod +x /app/entrypoint.sh

USER node
EXPOSE 10000

ENTRYPOINT ["/app/entrypoint.sh"]
