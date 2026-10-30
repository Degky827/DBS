# Environment Setup and Variable Inventory

**Last verified:** 2026-10-29  
**Scope:** auth-service, user-service, kyc-service, frontend, Docker Compose, CI.

This document is the authoritative inventory of environment variables actually read by
the application. It was built by inspecting `src/config/env.js` and the runtime reads in
each service, not by copying a template.

## 1. Configuration loading

| Component | Loader | Notes |
|---|---|---|
| auth-service | `dotenv` from `backend/auth-service/.env`, then process environment | Compose/production must inject values; a real `.env` is never committed |
| user-service | `dotenv` from `backend/user-service/.env`, then process environment | `DATABASE_URL` is required |
| kyc-service | `dotenv` from `backend/kyc-service/.env`, then process environment | `STORAGE_ENCRYPTION_KEY` is required in production |
| frontend | Vite `import.meta.env.VITE_*` at build time | Only public values; never secrets |
| Prisma CLI | `prisma.config.mjs` reads `DATABASE_URL` | Used by `prisma migrate deploy` and `prisma generate` |
| Docker Compose | Root `.env` interpolation plus per-service `environment:` blocks | See `docker-compose.yml` and `.env.production.example` |

Templates that are safe to commit:

- `backend/auth-service/.env.example`
- `backend/user-service/.env.example`
- `backend/kyc-service/.env.example`
- `frontend/.env.example`
- `.env.production.example`

Real `.env` files are ignored by the root `.gitignore`. `frontend/.env` is no longer
tracked; create it locally from `frontend/.env.example`.

## 2. Values that must match across services

| Value | Services | Consequence if mismatched |
|---|---|---|
| `JWT_ALGORITHM` | auth, user, KYC | Verifiers reject access tokens |
| `JWT_SECRET` (HS256) | auth signs; user and KYC verify | All authenticated requests fail with 401 |
| `JWT_PUBLIC_KEY_BASE64` / `JWT_PUBLIC_KEY` (RS256) | user and KYC verify; auth signs with the private key | All authenticated requests fail with 401 |
| `JWT_ISSUER`, `JWT_AUDIENCE` | auth, user, KYC | Token verification fails |
| `INTERNAL_SERVICE_KEY` | auth, user, KYC | Internal KYC-status calls and password-change proxying fail with 401 |
| `APP_ORIGIN` / `CORS_ORIGIN` | auth, user, KYC, Nginx | Cookie endpoints reject browser requests; CORS fails |
| `POSTGRES_*` | all services via Compose | Services cannot connect to their databases |
| `CHAPA_CALLBACK_URL` / `CHAPA_RETURN_URL` | user-service and the public HTTPS host | Chapa cannot notify or redirect the browser |

The browser-facing refresh cookie path is `/api/auth` in the Compose/Nginx topology and
`/api/v1/auth` when the auth service is called directly. It must match the URL the
browser actually calls.

## 3. auth-service

| Variable | Required | Secret | Format / default | Purpose and behavior when missing |
|---|---|---|---|---|
| `NODE_ENV` | Yes in deployed environments | No | `development` \| `test` \| `production` | Selects production validation |
| `PORT` | No | No | Integer, default `5001` | HTTP listener |
| `DB_ADAPTER` | No | No | `pg` (default) or `neon` | Prisma driver adapter |
| `DATABASE_URL` | Yes | Yes | PostgreSQL URL | Startup fails if missing |
| `JWT_ALGORITHM` | No | No | `HS256` (default) or `RS256` | Signing algorithm |
| `JWT_SECRET` | HS256 only | Yes | 32+ high-entropy chars in production | Startup fails if missing/weak in production |
| `JWT_PRIVATE_KEY_BASE64` / `JWT_PRIVATE_KEY` | RS256 only | Yes | Base64-encoded PKCS#8 PEM | Startup fails without a valid private key |
| `JWT_PUBLIC_KEY_BASE64` / `JWT_PUBLIC_KEY` | RS256 only | No (public) | Base64-encoded SPKI PEM | Startup fails without a valid public key |
| `JWT_KEY_ID` | No | No | String | `kid` header for key rotation |
| `JWT_EXPIRES_IN` | No | No | Default `15m` | Access-token lifetime |
| `JWT_ISSUER` / `JWT_AUDIENCE` | No | No | Defaults `auth-service` / `banking-system` | Must match verifiers |
| `REFRESH_TOKEN_TTL_MS` | No | No | Default 7 days | Refresh-session lifetime |
| `REFRESH_TOKEN_GRACE_MS` | No | No | Default 30 s | Concurrent-refresh grace window |
| `REFRESH_COOKIE_NAME` | No | No | Default `meridian_refresh` | Cookie name |
| `REFRESH_COOKIE_PATH` | No | No | Default `/api/v1/auth` | Must match browser-visible path |
| `REFRESH_COOKIE_SAME_SITE` | No | No | `lax` (default), `strict`, `none` | `none` requires `COOKIE_SECURE=true` |
| `COOKIE_SECURE` | Yes in production | No | Boolean | Production startup fails when false |
| `ALLOW_INSECURE_COOKIES` | No | No | Boolean, default false | Development escape hatch; do not use in production |
| `BCRYPT_ROUNDS` | No | No | Default 12 | Password hash cost |
| `CORS_ORIGIN` | No | No | Comma-separated bare HTTPS origins in production | Wildcards and HTTP origins are rejected in production |
| `TRUST_PROXY` | No | No | Integer hops, default 1 in production | Express trusted proxy setting |
| `ENABLE_HSTS` | No | No | Boolean | Enables HSTS only when behind HTTPS |
| `INTERNAL_SERVICE_KEY` | Yes in production | Yes | 32+ high-entropy chars | Guards internal service endpoints |
| `BREVO_API_KEY` | **Yes in production** | Yes | `xkeysib-...` (REST) or `xsmtpsib-...` (SMTP) | Startup fails in production without it because verification and reset email would be undeliverable |
| `EMAIL_TRANSPORT` | No | No | `api` or `smtp`; auto-detected from key prefix | Must match the key type when set |
| `EMAIL_FROM` / `EMAIL_FROM_EMAIL` | No | No | Display name / sender address | Sender identity |
| `EMAIL_SMTP_USER` | SMTP only | No | Brevo account login | SMTP auth user |
| `EMAIL_SMTP_HOST` / `EMAIL_SMTP_PORT` | No | No | Default `smtp-relay.brevo.com` / `587` | SMTP transport |
| `LOG_LEVEL` | No | No | Default `info` | Pino level |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | No | No | Default 15 min / 300 | Global API limiter |
| `LOGIN_RATE_LIMIT_MAX` | No | No | Default 10 | Per IP + email login limiter |
| `SENSITIVE_AUTH_RATE_LIMIT_MAX` | No | No | Default 20 | Register/OTP/reset limiter |
| `REFRESH_RATE_LIMIT_MAX` | No | No | Default 60 | Refresh/logout limiter |
| `ENABLE_API_DOCS` | No | No | Default true in development, false in production | Swagger UI |
| `API_DOCS_USERNAME` / `API_DOCS_PASSWORD` | Only when docs are enabled in production | Password is secret | Username + 16+ char password | Basic auth for docs |

## 4. user-service

| Variable | Required | Secret | Format / default | Purpose and behavior when missing |
|---|---|---|---|---|
| `NODE_ENV` | Yes in deployed environments | No | `development` \| `test` \| `production` | Selects production validation |
| `PORT` | No | No | Default `5002` | HTTP listener |
| `DB_ADAPTER` | No | No | `pg` only | Prisma driver adapter |
| `DATABASE_URL` | Yes | Yes | PostgreSQL URL | Startup fails if missing |
| `AUTH_MODE` | No | No | `dev` (default) or `jwt`; `dev` is rejected in production | `jwt` verifies auth-service tokens |
| `DEV_SESSION_TTL_MS` / `DEV_API_KEY` | Dev only | Optional | Default 8 h / empty | Standalone development authentication |
| `JWT_ALGORITHM` | No | No | `HS256` (default) or `RS256` | Must match auth-service |
| `JWT_SECRET` / `JWT_PUBLIC_KEY_BASE64` | When `AUTH_MODE=jwt` | Yes / public | Same material as auth-service | Startup fails when missing or invalid |
| `JWT_ISSUER` / `JWT_AUDIENCE` | No | No | Defaults `auth-service` / `banking-system` | Token verification |
| `AUTH_SERVICE_URL` | No | No | Base URL, default `http://localhost:5001/api/v1` | Password-change proxy |
| `KYC_SERVICE_URL` | No | No | Base URL, default empty | Wallet, transfer, and deposit operations fail closed with `503 KYC_STATUS_UNAVAILABLE` when unset/unreachable |
| `INTERNAL_SERVICE_KEY` | Yes in production when KYC is configured | Yes | 32+ high-entropy chars | Internal KYC-status calls |
| `AVATAR_UPLOAD_DIR` | No | No | Default `./uploads/avatars` | Avatar storage |
| `BCRYPT_ROUNDS` | No | No | Default 12 | Password hash cost |
| `CORS_ORIGIN` | No | No | Explicit origins | Wildcards rejected |
| `TRUST_PROXY` / `ENABLE_HSTS` | No | No | As auth-service | Proxy/HSTS behavior |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | No | No | Default 15 min / 300 | Global limiter |
| `AUTH_RATE_LIMIT_MAX` | No | No | Default 20 | Authenticated profile/password operations |
| `LOG_LEVEL` | No | No | Default `info` | Pino level |
| `ENABLE_API_DOCS` / `API_DOCS_USERNAME` / `API_DOCS_PASSWORD` | Docs only | Password is secret | As auth-service | Swagger UI |
| `CHAPA_SECRET_KEY` | No | Yes | Must match `CHAPA_TEST_...` | Deposits stay disabled when empty |
| `CHAPA_WEBHOOK_SECRET` | When Chapa is enabled | Yes | 16+ chars | Webhook HMAC |
| `CHAPA_BASE_URL` | No | No | Must be `https://api.chapa.global` | Pinned test-mode host |
| `CHAPA_CALLBACK_URL` / `CHAPA_RETURN_URL` | When Chapa is enabled | No | HTTPS URLs | Provider callback and browser return |
| `RECONCILIATION_ENABLED` | No | No | Default false | Scheduled reconciliation |
| `RECONCILIATION_INTERVAL_MS` / `RECONCILIATION_STALE_MINUTES` / `RECONCILIATION_BATCH_SIZE` | No | No | Defaults 5 min / 15 min / 25 | Reconciliation tuning |

## 5. kyc-service

| Variable | Required | Secret | Format / default | Purpose and behavior when missing |
|---|---|---|---|---|
| `NODE_ENV` | Yes in deployed environments | No | `development` \| `test` \| `production` | Selects production validation |
| `PORT` | No | No | Default `5003` | HTTP listener |
| `DB_ADAPTER` | No | No | `pg` only | Prisma driver adapter |
| `DATABASE_URL` | Yes | Yes | PostgreSQL URL | Startup fails if missing |
| `JWT_ALGORITHM` / `JWT_SECRET` / `JWT_PUBLIC_KEY_BASE64` | As user-service | Yes / public | Same material as auth-service | Token verification |
| `JWT_ISSUER` / `JWT_AUDIENCE` | No | No | Defaults `auth-service` / `banking-system` | Token verification |
| `INTERNAL_SERVICE_KEY` | Yes in production | Yes | 32+ high-entropy chars | Internal status and officer-document routes |
| `USER_SERVICE_URL` | No | No | Default `http://localhost:5002/api/v1` | Profile lookup/comparison |
| `AUTH_SERVICE_URL` | No | No | Default `http://localhost:5001/api/v1` | Officer/account lookup |
| `CORS_ORIGIN` / `TRUST_PROXY` / `ENABLE_HSTS` | No | No | As auth-service | Browser/proxy behavior |
| `LOG_LEVEL` | No | No | Default `info` | Pino level |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | No | No | Default 15 min / 300 | Global limiter |
| `UPLOAD_RATE_LIMIT_MAX` | No | No | Default 10 | Document-upload limiter |
| `AUTH_RATE_LIMIT_MAX` | No | No | Default 20 | Sensitive authenticated operations |
| `ENABLE_API_DOCS` / `API_DOCS_USERNAME` / `API_DOCS_PASSWORD` | Docs only | Password is secret | As auth-service | Swagger UI |
| `STORAGE_DIR` | No | No | Default `<service>/storage` | Encrypted document storage |
| `MAX_FILE_SIZE_BYTES` | No | No | Default 10 MiB | Upload size limit |
| `STORAGE_ENCRYPTION_KEY` | **Yes in production** | Yes | Exactly 64 hex characters | AES-256-GCM document encryption; startup fails if missing/malformed. Losing it makes stored documents unreadable |
| `DIDIT_API_BASE_URL` | No | No | Must be `https://verification.didit.me` | Pinned provider origin |
| `DIDIT_API_KEY` | No | Yes | Provider API key | Didit session creation; returns 503 when unconfigured |
| `DIDIT_WORKFLOW_ID` | No | No | Workflow UUID | Didit workflow |
| `DIDIT_WEBHOOK_SECRET` | No | Yes | Provider signing secret | Webhook verification; returns 503 when unconfigured |
| `DIDIT_WEBHOOK_SECRET_PREVIOUS` | No | Yes | Previous signing secret | Rotation overlap window |

## 6. frontend

| Variable | Required | Secret | Notes |
|---|---|---|---|
| `VITE_AUTH_API` | Yes | No | Dev default `http://localhost:5001/api/v1`; production image default `/api/auth` |
| `VITE_USER_API` | Yes | No | Dev default `http://localhost:5002/api/v1`; production default `/api/user` |
| `VITE_KYC_API` | Yes | No | Dev default `http://localhost:5003/api/v1/kyc`; production default `/api/kyc` |

Vite inlines every `VITE_*` variable into the browser bundle. Never place database
credentials, JWT secrets, internal service keys, webhook secrets, provider API keys, or
encryption keys in frontend variables.

## 7. Production Compose-only values

These are consumed by `docker-compose.yml` interpolation rather than by Node code:
`APP_ORIGIN`, `FRONTEND_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `VITE_AUTH_API`,
`VITE_USER_API`, `VITE_KYC_API`. The services receive concrete `DATABASE_URL`,
`CORS_ORIGIN`, and proxy settings from the Compose file.

## 8. Local setup

```bash
# Backend dependencies
cd backend/auth-service && npm ci
cd ../user-service && npm ci
cd ../kyc-service && npm ci
cd ../../frontend && npm ci

# Per-service configuration
cp backend/auth-service/.env.example backend/auth-service/.env
cp backend/user-service/.env.example backend/user-service/.env
cp backend/kyc-service/.env.example backend/kyc-service/.env
cp frontend/.env.example frontend/.env

# Generate secrets
openssl rand -hex 64   # JWT_SECRET (HS256)
openssl rand -hex 32   # INTERNAL_SERVICE_KEY
openssl rand -hex 32   # STORAGE_ENCRYPTION_KEY (64 hex chars)

# Migrate and run
cd backend/auth-service && npx prisma generate && npx prisma migrate deploy && npm run dev
```

Use a separate database per service (`auth_db`, `user_db`, `kyc_db`). Test databases must
end in `_test` and must never be production databases.

## 9. Startup validation summary

The services fail fast instead of starting with unsafe or non-functional configuration:

- auth-service: missing/weak `JWT_SECRET` or `INTERNAL_SERVICE_KEY`, insecure cookie,
  wildcard/HTTP production origin, missing Brevo key, mismatched email transport/key type,
  docs enabled without credentials.
- user-service: missing `AUTH_MODE=jwt` secret/key, missing `INTERNAL_SERVICE_KEY` when KYC
  is configured, unsafe production origin, invalid or incomplete Chapa configuration.
- kyc-service: missing/weak JWT or internal key, missing or malformed
  `STORAGE_ENCRYPTION_KEY`, non-Didit API origin, unsafe production origin, docs enabled
  without credentials.

## 10. Redis, RabbitMQ, MinIO, and other infrastructure

No application code reads environment variables for Redis, RabbitMQ, MinIO, or object
storage. Those services are intentionally absent from the Compose files. Adding them
requires a real integration first (for example, Redis-backed rate limiting or session
storage), not just new environment variables. Do not add credentials for unused services
to production templates.

## 11. What to do when a credential is unavailable

1. Leave the corresponding feature disabled; do not invent placeholder credentials.
2. In production, auth-service now refuses to start without a Brevo key because login
   requires a verified email address.
3. Chapa deposits remain disabled and return an explicit configuration error until a
   `CHAPA_TEST_` key and the three companion values are supplied.
4. Didit session creation returns 503 until the API key, workflow ID, and webhook secret
   are supplied.
5. Record the missing credential in the release checklist and verify the integration in a
   sandbox before enabling it for users.
