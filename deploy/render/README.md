# Render deployment

Free-tier deployment of the DBS banking demonstration on [Render](https://render.com).
The development stack still runs with `docker compose`; nothing in this
directory changes the Compose topology or the Oracle bundle in `deploy/oracle/`.

> University demonstration only. Use synthetic accounts, dummy transactions and
> test KYC data. This is not a production banking environment.

## Why a single container

Render's free plan constrains the topology:

- A free web service sleeps after 15 minutes of inactivity.
- All free services in a workspace share **750 instance-hours per month**.
  Four always-on Node services plus a gateway would consume about 2,976 hours.
- Free web services can **send but not receive private-network traffic**, so
  service-to-service calls over Render's private network are not available.
- Free services have **no persistent disk**; the filesystem is ephemeral.

The image in this directory therefore runs the same five processes that
Compose runs — four Node services and the Nginx SPA gateway — inside one
container. Each service keeps its own source tree, port, database, migrations
and health endpoint:

| Process | Port | Database | Responsibility |
| --- | --- | --- | --- |
| auth-service | 5001 | `AUTH_DATABASE_URL` | Registration, login, JWT, refresh cookies, MFA, OTP, password reset |
| user-service | 5002 | `USER_DATABASE_URL` | Profiles, wallets, transfers, scheduled transfers, statements, avatars, Chapa deposits |
| kyc-service | 5003 | `KYC_DATABASE_URL` | KYC submissions, document storage, Didit provider flow |
| notification-service | 5004 | `NOTIFICATION_DATABASE_URL` | Notifications, outbox delivery, transactional email |
| nginx | `$PORT` | — | SPA hosting, `/api/*` proxy, uploads, security headers |
| health aggregator | 5050 (loopback) | — | `/healthz` readiness for Render |

Startup order inside the container:

```
four `prisma migrate deploy` runs (parallel)
        -> optional idempotent demo seed
        -> auth, user, kyc, notification, health aggregator
        -> nginx on $PORT
```

If any process exits, the entrypoint stops the container so Render restarts it.
`SIGTERM` is forwarded to every child for graceful shutdown.

The public gateway preserves the logical API boundaries that the frontend
already uses:

- `/api/auth/*` → auth-service `/api/v1/*`
- `/api/user/*` → user-service `/api/v1/*`
- `/api/kyc/*` → kyc-service `/api/v1/kyc/*`
- `/api/notifications/*` → notification-service `/api/v1/*`
- `/api/*/internal/*` → denied at the gateway
- `/uploads/avatars/*` → user-service

Because the SPA and the API share one origin, the refresh cookie keeps
`Path=/api/auth`, `HttpOnly`, `Secure` and `SameSite=Lax` without cross-site
workarounds.

`TRUST_PROXY=2` reflects the two proxies in front of every service: Render's
edge proxy and the bundled nginx. With a smaller value, rate limits and audit
logs would key on the edge IP instead of the client IP. Do not copy this value
to the Compose stack, where nginx is the only proxy.

## Free-tier resources

| Resource | Provider | Required | Notes |
| --- | --- | --- | --- |
| Web service | Render free | Yes | 512 MB RAM, 0.1 CPU, sleeps after 15 min, 750 h/month shared |
| PostgreSQL | [Neon](https://neon.tech) free | Yes | No card required. One project, four databases, TLS required |
| Redis | [Upstash](https://upstash.com) free | No | Rate-limit windows and KYC status cache; per-process fallback is safe |
| Email | [Brevo](https://brevo.com) or [SendGrid](https://sendgrid.com) free | Yes | HTTPS API only; Render blocks SMTP 25/465/587 |
| KYC | Didit sandbox | No | Keep empty to disable provider verification |
| Deposits | Chapa test mode | No | Never enable live mode for this demonstration |

No Render Postgres, disk, paid instance or paid add-on is declared in
`render.yaml`. Render's free PostgreSQL expires after 30 days, which is why it
is not used.

### Memory risk

The consolidated image measured roughly 360 MB across the same five processes
in local Compose. Render free provides 512 MB. Expect a cold start of
30–90 seconds (migrations run on every boot and the service may be asleep) and
watch memory usage in the Render dashboard. If the instance is killed for
exceeding memory:

1. Leave `REDIS_URL` unset (saves a client connection and buffer).
2. Keep `ENABLE_API_DOCS=false` and `LOG_LEVEL=info`.
3. Do not reduce below one instance per service inside the container.

Splitting services across multiple free web services is not possible for
private traffic, and moving to a paid instance requires approval — see
[Approval gates](#approval-gates).

## Repository layout

```
render.yaml                          Blueprint: one free Docker web service
deploy/render/
  Dockerfile                         Consolidated multi-stage image
  entrypoint.sh                      Migrations, seed, process supervision
  health.js                          /healthz aggregator
  nginx/                             SPA + API gateway configuration
  migrator/                          Prisma CLI package used for migrations
  environments/*.example.env         Variable matrix (no real values)
  scripts/pre-deploy.sh              Validate env, DB connectivity, migrations
  scripts/health-check.sh            Read-only probes against a deployed URL
  scripts/deployment-verification.sh Login, cookie, JWT, CSRF, SPA checks
```

`deploy/oracle/` is preserved unchanged. Nothing in this directory deletes or
modifies it.

## Setup

### 1. Neon PostgreSQL

1. Create a free Neon account and project (no card).
2. Create four databases in that project: `auth_db`, `user_db`, `kyc_db`,
   `notification_db`. Keep the default `neondb` for the auth service or rename
   it consistently.
3. Copy the **direct** connection string (not the pooled one) for each
   database and append `?sslmode=require`.
4. Verify each URL answers `SELECT 1` before deploying; `pre-deploy.sh` does
   this.

Migrations are applied with `prisma migrate deploy` on every container boot.
They are additive/forward-only. **Never** run `prisma migrate reset` against
these databases and never point them at an existing production database.

### 2. Transactional email (Brevo or SendGrid)

Pick one HTTPS provider; both have free tiers without a card. Render blocks
outbound SMTP on the free plan, so only the REST APIs are supported.

**SendGrid** (100 emails/day free):

1. Create a free SendGrid account.
2. Complete **Single Sender Verification** for the address you will send from
   (Settings → Sender Authentication). A personal Gmail address works; click
   the verification link sent to that inbox.
3. Create an API key (Settings → API Keys) with **Mail Send** permission; it
   starts with `SG.`.
4. Set `SENDGRID_API_KEY` and `EMAIL_FROM_EMAIL` to the verified sender.

**Brevo** (300 emails/day free):

1. Create a free Brevo account and verify a sender address or domain.
2. Create an API key from the **API Keys** tab (not the SMTP tab); it starts
   with `xkeysib-`.
3. Set `BREVO_API_KEY` and `EMAIL_FROM_EMAIL` to the verified sender.

Transport selection: leave `EMAIL_TRANSPORT` unset to auto-detect (SendGrid
wins if both keys are set), or pin `EMAIL_TRANSPORT=sendgrid` / `api` (Brevo).
The services call `https://api.sendgrid.com/v3/mail/send` or
`https://api.brevo.com/v3/smtp/email`. No SMTP credentials are used.

### 3. Optional Upstash Redis

1. Create a free Upstash Redis database with TLS.
2. Set `REDIS_URL=rediss://...`.
3. If unset, each process uses in-memory rate-limit windows and a 10-second KYC
   status cache. That is safe because exactly one process of each service runs.

### 4. Render Blueprint

1. Push the repository to GitHub on the `dev` branch (never `main`).
2. In Render: **New → Blueprint**, select the repository, and apply
   `render.yaml`.
3. Render creates one free web service named `dbs-demo` and prompts for every
   `sync: false` variable. Paste the values from your private env file.
4. `JWT_SECRET` and `INTERNAL_SERVICE_KEY` are generated by Render. Do not
   replace them without invalidating all sessions.
5. Wait for the first build and health check. The URL is shown in the Render
   dashboard; record it and run the verification script.

If the Blueprint is applied from a fork or a different service name, update
`name`, `region` and `branch` in `render.yaml` before applying it. The public
URL is not hard-coded anywhere: `APP_ORIGIN` and `CORS_ORIGIN` are derived from
`RENDER_EXTERNAL_URL` at boot.

## Secrets

The Blueprint prompts for these; none are committed:

| Variable | Generation |
| --- | --- |
| `JWT_SECRET` | Render `generateValue: true` |
| `INTERNAL_SERVICE_KEY` | Render `generateValue: true` |
| `STORAGE_ENCRYPTION_KEY` | `openssl rand -hex 32` (64 hex chars) |
| `MFA_ENCRYPTION_KEY` | `openssl rand -hex 32` (64 hex chars) |
| `DEMO_SEED_PASSWORD` | Any random string of 12+ characters |
| `AUTH_DATABASE_URL` etc. | Neon connection strings with `sslmode=require` |
| `BREVO_API_KEY` | Brevo dashboard (`xkeysib-`); optional if SendGrid is used |
| `SENDGRID_API_KEY` | SendGrid dashboard (`SG.`); optional if Brevo is used |
| `EMAIL_FROM_EMAIL` | Sender verified with the chosen email provider |
| `CHAPA_*`, `DIDIT_*` | Sandbox dashboards only; leave empty to disable |

Rules enforced by this setup:

- No secret is written into the repository, the image, or a Docker build
  argument. `VITE_*` build arguments contain only relative API paths.
- Losing `STORAGE_ENCRYPTION_KEY` makes stored KYC documents unreadable.
  Back it up in a password manager outside the repository.
- Rotating `STORAGE_ENCRYPTION_KEY`: set the new key as
  `STORAGE_ENCRYPTION_KEY`, put the old key in
  `STORAGE_ENCRYPTION_KEYS_PREVIOUS`, and run
  `backend/kyc-service/scripts/rotateEncryptionKey.js` from a trusted machine
  with the production `KYC_DATABASE_URL`.
- Internal service routes are authenticated with `INTERNAL_SERVICE_KEY` and
  blocked at the gateway. Never expose that key to the browser.

## Demo accounts

`DEMO_SEED_ENABLED=true` runs the idempotent seed from
`backend/auth-service/prisma/seed.js` after migrations. Accounts (all use
`DEMO_SEED_PASSWORD`):

| Email | Role |
| --- | --- |
| `demo@meridianbank.test` | Customer |
| `admin@meridianbank.test` | Administrator |
| `officer.kyc@meridianbank.test` | KYC officer |
| `officer.finance@meridianbank.test` | Finance officer |

Profiles and wallets are created lazily from the verified JWT on first access.
The seed upserts by email and does not touch other rows. `update: {}` means an
existing demo account keeps its password: changing `DEMO_SEED_PASSWORD` later
only affects accounts that are missing. To reset a demo password, use the
application's password-reset flow or the admin endpoints.

On a public URL, anyone can log in with these accounts. Keep the demo free of
real personal data, and disable the seed (`DEMO_SEED_ENABLED=false`) for any
deployment that is not an isolated demonstration.

## Build and run locally

From the repository root:

```bash
# Build the exact image Render builds (repo root is the context)
docker build -f deploy/render/Dockerfile -t dbs-render:local .

# The demo seed and migrations are applied on start, so point this at the
# disposable *_test databases, not at a database with data you care about.
# Git Bash on Windows also needs MSYS_NO_PATHCONV=1 or it rewrites
# REFRESH_COOKIE_PATH into a Windows path.
MSYS_NO_PATHCONV=1 docker run --rm --name dbs-render-local -p 10000:10000 \
  --network banking-system_backend \
  -e PORT=10000 \
  -e NODE_ENV=development \
  -e APP_ORIGIN=http://localhost:10000 \
  -e CORS_ORIGIN=http://localhost:10000 \
  -e REFRESH_COOKIE_PATH=/api/auth \
  -e COOKIE_SECURE=false \
  -e AUTH_DATABASE_URL="postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@postgres:5432/auth_test?schema=public" \
  -e USER_DATABASE_URL="postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@postgres:5432/user_test?schema=public" \
  -e KYC_DATABASE_URL="postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@postgres:5432/kyc_test?schema=public" \
  -e NOTIFICATION_DATABASE_URL="postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@postgres:5432/notification_test?schema=public" \
  -e JWT_SECRET="$(openssl rand -hex 48)" \
  -e INTERNAL_SERVICE_KEY="$(openssl rand -hex 48)" \
  -e STORAGE_ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  -e MFA_ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  -e STORAGE_BACKEND=postgres \
  -e AVATAR_STORAGE_BACKEND=postgres \
  -e EMAIL_ENABLED=false \
  -e DB_ADAPTER=pg \
  -e AUTH_MODE=jwt \
  -e AUTH_SERVICE_URL=http://127.0.0.1:5001/api/v1 \
  -e USER_SERVICE_URL=http://127.0.0.1:5002/api/v1 \
  -e KYC_SERVICE_URL=http://127.0.0.1:5003/api/v1/kyc \
  -e NOTIFICATION_SERVICE_URL=http://127.0.0.1:5004/api/v1 \
  -e DEMO_SEED_ENABLED=true \
  -e DEMO_SEED_PASSWORD="$(openssl rand -hex 16)" \
  dbs-render:local
```

Never pass `EMAIL_ENABLED=true` with a production email-provider key for a
local run.
The database names come from `scripts/create-test-databases.sh` or the Compose
PostgreSQL service. Do not copy the root `.env` into the image.

## Verification

Read-only probes (safe to run anytime):

```bash
BASE_URL=https://dbs-demo.onrender.com ./deploy/render/scripts/health-check.sh
```

Full verification (requires the demo password):

```bash
BASE_URL=https://dbs-demo.onrender.com \
DEMO_SEED_PASSWORD='...' \
./deploy/render/scripts/deployment-verification.sh
```

It checks readiness (with cold-start retries), the four service health
endpoints, `SELECT 1` through `/api/auth/ready`, demo login, refresh-cookie
flags and path, JWT-protected routes, unauthenticated rejection, internal-route
blocking, CSRF origin rejection, SPA deep links and security headers. It never
prints tokens or secrets.

Pre-deployment checks against your private env file:

```bash
./deploy/render/scripts/pre-deploy.sh --env-file .env.render
./deploy/render/scripts/pre-deploy.sh --env-file .env.render --check-only
```

Manual checks that cannot be automated without provider accounts:

- Register a new synthetic account and confirm the OTP email arrives.
- Request a password reset and complete the flow.
- Run a Chapa **test-mode** deposit and confirm the callback/webhook updates
  the wallet.
- Run a Didit **sandbox** KYC submission and confirm the callback updates the
  case.
- Upload an avatar and a KYC document, then confirm they survive a redeploy
  (Postgres-backed storage).

## Planned limitations

- **Jobs**: outbox, scheduled transfers, ledger verification and KYC
  reverification are enabled because exactly one container runs. Do not scale
  this service above one instance without adding a distributed lock.
- **Cold starts**: Render free sleeps after 15 minutes. The first request can
  take a minute while migrations and services start.
- **Ephemeral disk**: no local uploads. `STORAGE_BACKEND=postgres` and
  `AVATAR_STORAGE_BACKEND=postgres` store encrypted documents and avatars in
  PostgreSQL. This adds rows and bandwidth; keep the demo dataset small.
- **Redis is optional**: without Upstash, rate limits are per process and
  reset on restart, and the KYC cache is per process.
- **Email**: the free provider tier has a daily sending limit (SendGrid 100,
  Brevo 300). OTP and reset delivery depend on a verified sender and sender
  reputation.
- **PostgreSQL**: Neon free has storage and compute limits and may suspend
  idle compute. The first login after a long idle period can be slow.
- **Payments/KYC**: Chapa and Didit are sandbox-only. No live money movement is
  configured or recommended.
- **Unused integrations**: RabbitMQ and MinIO appear only in old documentation
  and are not used by the application code. Nothing is lost by not hosting
  them.
- **Security monitoring**: no WAF, fraud engine, AML/sanctions screening or
  central log drain is included on the free plan.

## Rollback

- Redeploy a previous commit from the Render dashboard; the image is rebuilt
  from that commit.
- Database migrations are forward-only. Before a risky change, take a Neon
  branch or export a synthetic-only dump. Never restore a production database
  over this demo.
- To take the demo offline, suspend the Render service. Free services do not
  bill while suspended, but the Neon project keeps its free quota.

## Approval gates

Stop and ask the repository owner before any of the following:

- Selecting a paid Render instance, disk or database.
- Enabling Chapa live mode or using real payment credentials.
- Pointing the deployment at an existing production database or copying real
  customer data.
- Adding a custom domain that requires DNS changes outside the repository.
- Splitting the single container across multiple paid services.
