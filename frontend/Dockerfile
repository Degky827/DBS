# syntax=docker/dockerfile:1

# ---------- Stage 1: build ----------
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_AUTH_API=/api/auth
ARG VITE_USER_API=/api/user
ARG VITE_KYC_API=/api/kyc
ARG VITE_NOTIFICATION_API=/api/notifications
ENV VITE_AUTH_API=$VITE_AUTH_API
ENV VITE_USER_API=$VITE_USER_API
ENV VITE_KYC_API=$VITE_KYC_API
ENV VITE_NOTIFICATION_API=$VITE_NOTIFICATION_API

RUN npm run build

# ---------- Stage 2: serve ----------
FROM nginx:alpine AS runtime

# The nginx tag ships whatever Alpine package versions existed when it was
# built. Upgrading inside the image picks up the patched libcurl, libexpat and
# brotli the scan requires, without waiting for an upstream rebuild.
RUN apk upgrade --no-cache

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/banking/tls.conf
COPY nginx.http.conf /etc/nginx/banking/http.conf
COPY nginx/ /etc/nginx/banking/
COPY docker-entrypoint.d/ /docker-entrypoint.d/
RUN chmod +x /docker-entrypoint.d/*.sh

EXPOSE 80 443

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz > /dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
