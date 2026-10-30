# Meridian — Digital Banking & Identity Verification Platform

Digital banking platform with authentication, user profiles, KYC verification, wallets, and same-currency transfers.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React, Vite, Redux Toolkit, Axios |
| Auth service | Node.js, Express 5, Prisma, PostgreSQL |
| User service | Node.js, Express 5, Prisma, PostgreSQL |
| KYC service | Node.js, Express 5, Prisma, PostgreSQL |
| Infrastructure | Docker Compose, Nginx, Swagger/OpenAPI |

## Repository layout

```
backend/
  auth-service/    # Registration, login, JWT, OTP, refresh sessions (:5001)
  user-service/    # Profiles, wallets, transfers, payments (:5002)
  kyc-service/     # KYC submissions and verification workflow (:5003)
frontend/          # React SPA (Vite dev server, Nginx in production)
docker-compose.yml      # Production-oriented stack (frontend only is published)
docker-compose.dev.yml  # Development stack with localhost ports and pgAdmin
docs/              # Project brief, operations guides, and audit reports
```

## Security model (Phase 2)

- **Access tokens** are short-lived (15 minutes by default), held in Redux memory only, and never written to `localStorage` or `sessionStorage`.
- **Refresh tokens** live in an `HttpOnly` cookie scoped to the auth API path. The server stores a hash of each token, rotates it on every refresh, and tracks token families.
- **Refresh reuse** outside a 30-second grace window revokes the whole family. Concurrent refreshes inside the grace window return `409 REFRESH_RACE`; the client retries once without clearing the cookie.
- **CSRF**: refresh and logout require an `Origin`/`Referer` matching `CORS_ORIGIN`; the cookie is `SameSite=Lax` by default.
- **Logout** revokes the family immediately and clears the cookie.
- **Rate limits** are layered: a global API limit, per-IP+email login limits, sensitive auth-operation limits, and refresh limits. Successful logins do not count against the login limit.
- **CORS** uses explicit origins only; wildcards are rejected. Only auth-service accepts credentialed CORS requests.
- **Headers** include CSP (`default-src 'none'` for APIs), `X-Content-Type-Options`, `Referrer-Policy`, frame protection, and conditional HSTS. Swagger routes receive a narrowly scoped relaxed CSP.
- **Secrets** are required in production: weak or missing `JWT_SECRET`/`INTERNAL_SERVICE_KEY`, HTTP origins, or insecure cookies stop startup. `AUTH_MODE=dev` is rejected when `NODE_ENV=production`.
- **API docs** are disabled in production by default. Enabling them requires Basic auth credentials.
- **Health**: `/health` is a liveness probe without database access; `/ready` checks the database and returns 503 when unavailable.

## Local development

### Option A — Docker (backend + database)

```bash
docker compose -f docker-compose.dev.yml up --build
```

The dev stack publishes:

| Service | URL |
|---|---|
| Auth API | http://localhost:5001/api/v1 |
| User API | http://localhost:5002/api/v1 |
| KYC API | http://localhost:5003/api/v1/kyc |
| Swagger | `/api/v1/docs` on each service |
| pgAdmin | http://localhost:5051 |
| SPA (optional profile) | http://localhost:8080 |

Development-only defaults are used for secrets; this file must never be deployed. The SPA container is behind the `spa` profile. For hot reload, run the frontend separately:

```bash
cd frontend
cp .env.example .env
npm install
npm run dev                       # http://localhost:5173
```

`frontend/.env.example` points at the published localhost APIs. Those origins must appear in each backend's `CORS_ORIGIN`.

### Option B — services on the host

1. Start PostgreSQL and create the databases:

```bash
docker compose -f docker-compose.dev.yml up -d postgres
docker exec -it meridian-dev-postgres-1 psql -U meridian -d postgres \
  -c "CREATE DATABASE user_db;" -c "CREATE DATABASE kyc_db;"
```

2. For each service, copy `.env.example` to `.env`, set `DATABASE_URL`, install dependencies, generate the Prisma client, migrate, and start:

```bash
cd backend/auth-service
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate deploy
npm run dev                       # http://localhost:5001
```

Repeat for `backend/user-service` (`user_db`) and `backend/kyc-service` (`kyc_db`). KYC document storage requires `STORAGE_ENCRYPTION_KEY` (64 hex characters).

Demo accounts: `npm run db:seed` in auth-service and user-service refuses to run with `NODE_ENV=production`; seeded passwords are for local development only.

## Production deployment

```bash
cp .env.production.example .env
# Fill in POSTGRES_PASSWORD, APP_ORIGIN, JWT_SECRET (or RS256 keys),
# INTERNAL_SERVICE_KEY, and STORAGE_ENCRYPTION_KEY.
docker compose up --build -d
```

Only `FRONTEND_PORT` (default 8080) is published. PostgreSQL, pgAdmin, and the three Node services have no host port mappings. Nginx serves the SPA and proxies:

| Browser path | Backend |
|---|---|
| `/api/auth/*` | auth-service `/api/v1/*` |
| `/api/user/*` | user-service `/api/v1/*` |
| `/api/kyc/*` | kyc-service `/api/v1/kyc/*` |

Because the browser sees a single origin, no CORS is involved and the refresh cookie is first-party. The production image builds the frontend with relative API bases. One-shot `*-migrate` services run `prisma migrate deploy` before each service starts.

`APP_ORIGIN` must be the public HTTPS origin. It drives CORS, the trusted-origin check on cookie endpoints, and (via Nginx) HSTS. Terminate TLS at the Nginx container or at an upstream load balancer that forwards `X-Forwarded-Proto: https`; `TRUST_PROXY=1` is set for the services.

### Secret generation

```bash
openssl rand -hex 64   # JWT_SECRET (HS256)
openssl rand -hex 32   # INTERNAL_SERVICE_KEY, STORAGE_ENCRYPTION_KEY
```

Do not commit `.env`; it is gitignored. For RS256, base64-encode the PEM files and provide `JWT_PRIVATE_KEY_BASE64` to auth-service and `JWT_PUBLIC_KEY_BASE64` to all three services. Verifiers pin the algorithm and never accept `alg: none` or a switch to HS256.

## API overview

| Service | Base URL (dev) | Endpoints |
|---|---|---|
| Auth | `http://localhost:5001/api/v1` | register, login, refresh, logout, verify-email, forgot/reset password, `/me` |
| User | `http://localhost:5002/api/v1` | profiles, wallets, same-currency transfers, transaction history; external payments disabled pending provider configuration |
| KYC | `http://localhost:5003/api/v1/kyc` | submissions, documents/OCR, provider sessions, webhooks, review |

All APIs use the envelope `{ success, message, data | errors }`. Login and refresh responses return the access token in JSON; the refresh token is only set as a cookie.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Registration, login, JWT | Done |
| 2 (security) | Cookie refresh sessions, headers, rate limits, secret and deployment hardening | Done |
| 3 | KYC submissions, identity checks, officer review | Done |
| 4 (operations) | Testing, CI/CD, deployment, backup & recovery | **Done for development/testing**; see the [production readiness report](docs/production-readiness-report.md) |
| 5 | Wallets and transactions | Double-entry ledger, atomic transfers, Chapa Test Mode deposits, admin reversals, configurable limits/fees, and stale-payment reconciliation implemented; withdrawal payouts require a payout-capable provider |

## Testing

### Running Tests

#### Backend Unit Tests

```bash
# Auth Service
cd backend/auth-service
npm test

# User Service: the full suite requires disposable PostgreSQL databases
# whose names end in _test. KYC_TEST_DATABASE_URL enables the five
# cross-service tests; without it they skip with an explicit reason.
cd backend/user-service
WALLET_TEST_DATABASE_URL='postgresql://auth:auth@localhost:5432/user_audit_test?schema=public' \
  npm run test:all

WALLET_TEST_DATABASE_URL='postgresql://auth:auth@localhost:5432/user_audit_test?schema=public' \
KYC_TEST_DATABASE_URL='postgresql://auth:auth@localhost:5432/kyc_audit_test?schema=public' \
  npm run test:all

# Ledger integrity check
DATABASE_URL='postgresql://auth:auth@localhost:5432/user_audit_test?schema=public' npm run ledger:verify

# KYC Service
cd backend/kyc-service
npm test
```

#### Frontend Tests

```bash
cd frontend
npm test
```

#### CI/CD

Tests run automatically via GitHub Actions on every pull request. See `.github/workflows/ci.yml`.

**Test Coverage:**
- 221 automated tests across four suites (52 auth, 113 user, 51 KYC, 5 frontend)
- Financial integrity (concurrency, precision, atomicity, ledger immutability)
- Security (JWT, refresh tokens, rate limiting, CORS/CSRF)
- Authentication flows (registration, login, password reset)
- KYC workflows (submissions, documents, verification, cross-service gating)

See `docs/testing-guide.md` for comprehensive testing documentation.

## Operations

### Deployment

See `docs/deployment-guide.md` for:
- Environment configuration
- Initial deployment steps
- Zero-downtime blue-green deployment
- Rollback procedures
- Migration management

### Backup & Recovery

See `docs/backup-and-recovery.md` for:
- Automated backup scripts
- GPG encryption procedures
- Recovery procedures
- Disaster recovery plan
- Monthly testing protocol

### Monitoring

Health check endpoints:
- `/api/v1/health` - Liveness (no database)
- `/api/v1/ready` - Readiness (includes database check)

Each service exposes both endpoints for load balancer health checks.

## Limitations

- user-service profile IDs are not yet unified with auth-service user IDs (`sub`); KYC eligibility uses the JWT subject.
- Wallet and payment tests that need PostgreSQL require `WALLET_TEST_DATABASE_URL` pointing at an isolated test database ending in `_test`.
- OCR downloads Tesseract language data on first use; the repository no longer carries an unused local `eng.traineddata` copy.
- External payments remain disabled unless Chapa Test Mode credentials are configured. Live payments are not supported.
- Redis, RabbitMQ, and MinIO are **not used by application code** and are not part of the Compose files. Add them only alongside a real integration.

## Documentation

| Document | Purpose |
|----------|---------|
| `README.md` | Project overview and quick start |
| `docs/production-readiness-report.md` | Evidence-based release status, defects fixed, and remaining blockers |
| `docs/environment-setup.md` | Complete environment-variable inventory and per-service setup |
| `docs/security-and-operations.md` | Security controls, monitoring, incident response, and secret rotation |
| `docs/provider-integration-testing.md` | Brevo, Chapa, and Didit configuration and verification status |
| `docs/deployment-guide.md` | Production deployment procedures |
| `docs/backup-and-recovery.md` | Data protection, restore rehearsal, and disaster recovery |
| `docs/testing-guide.md` | Testing infrastructure and procedures |
| `docs/phase4-final-report.md` | Phase 4 summary and production readiness |
| `docs/phase4-audit-and-plan.md` | Repository audit and implementation plan |

## License

UNLICENSED — internal project.
