# Meridian — Digital Banking & Identity Verification Platform

Digital banking platform with authentication, user profiles, KYC verification, wallets, same-currency transfers, domain-event notifications, statements, saved beneficiaries, scheduled transfers, and dispute management.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React, Vite, Redux Toolkit, Axios |
| Auth service | Node.js, Express 5, Prisma, PostgreSQL |
| User service | Node.js, Express 5, Prisma, PostgreSQL |
| KYC service | Node.js, Express 5, Prisma, PostgreSQL |
| Notification service | Node.js, Express 5, Prisma, PostgreSQL, Brevo email |
| Infrastructure | Docker Compose, Nginx, Swagger/OpenAPI |

## Repository layout

```
backend/
  auth-service/    # Registration, login, JWT, OTP, refresh sessions (:5001)
  user-service/    # Profiles, wallets, transfers, payments, statements, disputes (:5002)
  kyc-service/     # KYC submissions and verification workflow (:5003)
  notification-service/ # Outbox event consumption, in-app inbox, email delivery (:5004)
frontend/          # React SPA (Vite dev server, Nginx in production)
docker-compose.yml      # Production-oriented stack (frontend only is published)
docker-compose.dev.yml  # Development stack with localhost ports and pgAdmin
docs/              # Project brief, guides, service docs, and reports (see docs/README.md)
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

## Domain events and notifications

Banking actions publish events without calling the notification service inline:

1. `user-service` writes the ledger row and an `OutboxEvent` in the same PostgreSQL
   transaction, so an event only exists if the business change committed.
2. A dispatcher poller selects due events (unpublished, `nextAttemptAt` elapsed, attempt
   count below `OUTBOX_MAX_ATTEMPTS`) in batches of `OUTBOX_BATCH_SIZE` and posts each one
   to `POST /internal/notifications/events` on notification-service with the
   `X-Internal-Service-Key` header. Failures retry with exponential backoff (5 s doubled per
   attempt, capped at one hour); after `OUTBOX_MAX_ATTEMPTS` the event stops being retried
   and is replayed manually from `/admin/outbox`.
3. `notification-service` records the delivery, deduplicates by `eventId`
   (`ProcessedEvent`) and per recipient (`@@unique([eventId, recipientEmail])`),
   fans out to each audience member's inbox, and queues an email when `EMAIL_ENABLED=true`.
   A duplicate delivery returns `409`, which the dispatcher treats as already delivered so a
   lost acknowledgement cannot create a second notification.

In-app notifications are read with `GET /notifications`, `GET /notifications/unread-count`,
`POST /notifications/read-all`, and `POST /notifications/:notificationId/read`, all
authenticated with the same access token. The SPA header polls the unread count and
links to the inbox at `/notifications`.

| Event type | Trigger |
|---|---|
| `transfer.completed` | Successful wallet transfer (sender and recipient are notified) |
| `deposit.completed` | Verified deposit |
| `withdrawal.reserved` | Withdrawal initiated and funds reserved |
| `withdrawal.cancelled` | Withdrawal cancelled or failed, funds released |
| `account.status_changed` | Admin freeze, suspend, reactivate, or close |
| `dispute.opened` | Customer files a dispute |
| `dispute.updated` | Officer moves a dispute through the workflow |
| `scheduled_transfer.failed` | A scheduled transfer could not execute |

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
| Notification API | http://localhost:5004/api/v1 |
| Swagger | `/api/v1/docs` on auth, user, and KYC |
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
  -c "CREATE DATABASE user_db;" -c "CREATE DATABASE kyc_db;" -c "CREATE DATABASE notification_db;"
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

Repeat for `backend/user-service` (`user_db`), `backend/kyc-service` (`kyc_db`), and
`backend/notification-service` (`notification_db`). KYC document storage requires
`STORAGE_ENCRYPTION_KEY` (64 hex characters). Outbox delivery needs `NOTIFICATION_SERVICE_URL`
in user-service (for example `http://localhost:5004/api/v1`) together with a matching
`INTERNAL_SERVICE_KEY` in both services; leave `OUTBOX_ENABLED=false` to keep events queued
without dispatching them.

Demo accounts: `npm run db:seed` in auth-service and user-service refuses to run with `NODE_ENV=production`; seeded passwords are for local development only.

## Production deployment

```bash
cp .env.production.example .env
# Fill in POSTGRES_PASSWORD, APP_ORIGIN, JWT_SECRET (or RS256 keys),
# INTERNAL_SERVICE_KEY, and STORAGE_ENCRYPTION_KEY.
# Place the TLS certificate and key at certs/tls.crt and certs/tls.key.
docker compose up --build -d
```

The frontend container terminates TLS on port 443 and redirects HTTP on port 80.
`TLS_ENABLED=true` (the default in Compose) fails startup if the certificate
files are missing. Set `TLS_ENABLED=false` only when a trusted load balancer
terminates TLS. For a test certificate, run
`./scripts/generate-self-signed-cert.sh`.

Only `FRONTEND_HTTP_PORT` (default 80) and `FRONTEND_HTTPS_PORT` (default 443)
are published. PostgreSQL, pgAdmin, and the four Node services have no host port mappings. Nginx serves the SPA and proxies:

| Browser path | Backend |
|---|---|
| `/api/auth/*` | auth-service `/api/v1/*` |
| `/api/user/*` | user-service `/api/v1/*` |
| `/api/kyc/*` | kyc-service `/api/v1/kyc/*` |
| `/api/notifications/*` | notification-service `/api/v1/*` |

Requests that reach a service's `/internal/` path through any of those prefixes
are rejected at the proxy (`403`); internal endpoints are for container-network
traffic only.

Because the browser sees a single origin, no CORS is involved and the refresh cookie is first-party. The production image builds the frontend with relative API bases. One-shot `*-migrate` services run `prisma migrate deploy` before each service starts.

`APP_ORIGIN` must be the public HTTPS origin. It drives CORS, the trusted-origin check on cookie endpoints, and (via Nginx) HSTS. By default the Nginx container terminates TLS with `certs/tls.crt` and `certs/tls.key`; alternatively set `TLS_ENABLED=false` and terminate TLS at an upstream load balancer that forwards `X-Forwarded-Proto: https`. `TRUST_PROXY=1` is set for the services.

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
| User | `http://localhost:5002/api/v1` | profiles, wallets, same-currency transfers, transaction history, beneficiaries, scheduled transfers, statements (`/statements`, `/statements/export.pdf`), disputes, `/admin/outbox`; external payments disabled pending provider configuration |
| KYC | `http://localhost:5003/api/v1/kyc` | submissions, documents/OCR, provider sessions, webhooks, review |
| Notification | `http://localhost:5004/api/v1` | `/notifications`, `/notifications/unread-count`, `/notifications/:id/read`, `/notifications/read-all`, `/internal/notifications/events` (service key only) |

All APIs use the envelope `{ success, message, data | errors }`. Login and refresh responses return the access token in JSON; the refresh token is only set as a cookie.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Registration, login, JWT | Done |
| 2 (security) | Cookie refresh sessions, headers, rate limits, secret and deployment hardening | Done |
| 3 | KYC submissions, identity checks, officer review | Done |
| 4 (operations) | Testing, CI/CD, deployment, backup & recovery | **Done for development/testing**; see the [production readiness report](docs/reports/production-readiness-report.md) |
| 5 | Wallets and transactions | Double-entry ledger, atomic transfers, Chapa Test Mode deposits, admin reversals, configurable limits/fees, and stale-payment reconciliation implemented; withdrawal payouts require a payout-capable provider |
| 6 | Banking features and eventing | Done — transactional outbox with dispatcher and replay, notification service (in-app inbox plus Brevo email), statements and PDF export, saved beneficiaries, scheduled transfers, dispute management, and fail-closing CI security gates |

## Testing

### Running Tests

The integration suites expect disposable PostgreSQL databases. Create and
migrate them once with:

```bash
./scripts/create-test-databases.sh
```

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

# Notification Service (requires a disposable notification_test database)
cd backend/notification-service
NOTIFICATION_TEST_DATABASE_URL='postgresql://auth:auth@localhost:5432/notification_test?schema=public' npm test
```

The shared-rate-limit and KYC-cache specs need a reachable Redis and skip with an
explicit reason when `REDIS_URL` is unset. Point them at any disposable Redis
(the dev Compose stack publishes one on `127.0.0.1:6379`):

```bash
export REDIS_URL='redis://:dev-only-redis-password@127.0.0.1:6379'
cd backend/user-service
npm run test:rate-limit-store
npm run test:kyc-cache
```

#### Frontend Tests

```bash
cd frontend
npm test
```

#### CI/CD

Tests run automatically via GitHub Actions on every push and pull request to
`main`, `develop` and `dev`. See `.github/workflows/ci.yml` for the suite jobs and
the blocking gates: dependency audits (runtime dependencies must be clean at moderate,
everything at high), Prettier checks on changed sources, committed-secret guards, PR
dependency review, and Trivy scans of every built image (CRITICAL/HIGH block). Code
scanning runs separately in `.github/workflows/codeql.yml`.

**Test Coverage:**
- 422 automated tests across five suites (79 auth, 218 user, 95 KYC, 19 notification, 11 frontend); Redis-backed and optional-database specs skip with an explicit reason when their dependency is absent
- Financial integrity (concurrency, precision, atomicity, ledger immutability)
- Security (JWT, refresh tokens, rate limiting, CORS/CSRF)
- Authentication flows (registration, login, password reset)
- KYC workflows (submissions, documents, verification, cross-service gating)
- Eventing and banking features (outbox delivery and dedupe, notification inbox,
  email queueing, beneficiaries, scheduled transfers, statements, disputes)

See [`docs/operations/testing-guide.md`](docs/operations/testing-guide.md) for comprehensive testing documentation.

## Operations

### Deployment

See [`docs/deployment/deployment-guide.md`](docs/deployment/deployment-guide.md) for:
- Environment configuration
- Initial deployment steps
- Zero-downtime blue-green deployment
- Rollback procedures
- Migration management

### Backup & Recovery

See [`docs/deployment/backup-and-recovery.md`](docs/deployment/backup-and-recovery.md) for:
- `scripts/backup.sh` (database dumps, document volumes, SHA-256 manifest)
- GPG encryption and off-host retention
- `scripts/restore.sh` drills against throw-away databases
- In-place recovery procedure and post-restore checklist

### Monitoring

Health check endpoints:
- `/api/v1/health` - Liveness (no database)
- `/api/v1/ready` - Readiness (includes database check)

Each service exposes both endpoints for load balancer health checks.

Each service also exposes Prometheus metrics at `GET /metrics` on its private
port (never published through Nginx). The opt-in monitoring profile runs
Prometheus, Alertmanager, and an alert relay with availability, error-rate,
latency, security, KYC, and reconciliation alert rules:

```bash
docker compose --profile monitoring up -d
```

See [`docs/operations/security-and-operations.md` §10](docs/operations/security-and-operations.md#10-monitoring-and-alerting) for the exported series, alert list,
optional `METRICS_TOKEN` hardening, and alert forwarding configuration.

### Event delivery

Pending and failed outbox events are administered from the staff console
(`/admin/outbox`) or directly:

```bash
curl -H "Authorization: Bearer <staff token>" \
  'http://localhost:5002/api/v1/admin/outbox?status=failed'

curl -X POST -H "Authorization: Bearer <staff token>" \
  'http://localhost:5002/api/v1/admin/outbox/<eventId>/replay'
```

`replay` clears the attempt counter and re-queues the event for the dispatcher.
Events that reached `OUTBOX_MAX_ATTEMPTS` stay in `FAILED` until replayed, so
delivery resumes automatically once notification-service is healthy again.

## Limitations

- user-service profile IDs are not yet unified with auth-service user IDs (`sub`); KYC eligibility uses the JWT subject.
- Wallet and payment tests that need PostgreSQL require `WALLET_TEST_DATABASE_URL` pointing at an isolated test database ending in `_test`.
- OCR downloads Tesseract language data on first use; the repository no longer carries an unused local `eng.traineddata` copy.
- External payments remain disabled unless Chapa Test Mode credentials are configured. Live payments are not supported.
- Redis carries shared rate-limit windows and the short-lived KYC-status cache, and is part of both Compose files. It holds no session, credential, or financial record: with `REDIS_URL` unset every limiter counts per process and the cache is off. RabbitMQ and MinIO are still **not used by application code**; add them only alongside a real integration.
- The outbox dispatcher and the scheduled-transfer worker are in-process pollers. They run only while user-service runs, and they need no external broker; a long outage grows the backlog instead of dropping events.
- Dispute resolution records the officer's decision and the case timeline. Returning funds is a separate ledger action (`/transactions/:reference/reversals`) so a decision can never move money implicitly.
- Statements are generated on request from ledger rows; there is no archived statement store. Beneficiary account numbers are masked on read, so editing a beneficiary only changes the account number when a new value is typed.

## Documentation

All documentation lives under [`docs/`](docs/README.md), which indexes every
document by topic.

| Document | Purpose |
|----------|---------|
| [`docs/README.md`](docs/README.md) | Documentation index |
| [`docs/project-brief.md`](docs/project-brief.md) | Project brief, scope, and requirements |
| [`docs/deployment/environment-setup.md`](docs/deployment/environment-setup.md) | Complete environment-variable inventory and per-service setup |
| [`docs/deployment/deployment-guide.md`](docs/deployment/deployment-guide.md) | Production deployment procedures |
| [`docs/deployment/backup-and-recovery.md`](docs/deployment/backup-and-recovery.md) | Data protection, restore rehearsal, and disaster recovery |
| [`docs/operations/security-and-operations.md`](docs/operations/security-and-operations.md) | Security controls, monitoring, incident response, and secret rotation |
| [`docs/operations/provider-integration-testing.md`](docs/operations/provider-integration-testing.md) | Brevo, Chapa, and Didit configuration and verification status |
| [`docs/operations/testing-guide.md`](docs/operations/testing-guide.md) | Testing infrastructure and procedures |
| [`docs/architecture/ledger-design.md`](docs/architecture/ledger-design.md) | Double-entry ledger, money flow, and integrity guarantees |
| [`docs/architecture/user-auth-integration.md`](docs/architecture/user-auth-integration.md) | User-service ↔ auth-service identity integration contract |
| [`docs/services/user-service.md`](docs/services/user-service.md) | User-service setup, API surface, and operations |
| [`docs/services/kyc-service.md`](docs/services/kyc-service.md) | KYC-service setup, workflows, and operations |
| [`docs/reports/production-readiness-report.md`](docs/reports/production-readiness-report.md) | Evidence-based release status, defects fixed, and remaining blockers |
| [`docs/reports/security-audit-2026-11-04.md`](docs/reports/security-audit-2026-11-04.md) | Full-platform audit: architecture, credential exposure, fixes, residual risks |

## License

UNLICENSED — internal project.
