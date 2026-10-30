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
ENV VITE_AUTH_API=$VITE_AUTH_API
ENV VITE_USER_API=$VITE_USER_API
ENV VITE_KYC_API=$VITE_KYC_API

RUN npm run build

# ---------- Stage 2: serve ----------
FROM nginx:alpine AS runtime

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ > /dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
