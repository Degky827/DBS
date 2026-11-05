# Platform Audit — 2026-11-04

Scope: repository-wide audit of the Digital Banking and Identity Verification
Platform (React SPA, four Node.js/Express services, PostgreSQL 16, Prisma,
Docker Compose, Nginx, Chapa, Didit, Brevo). No credentials were rotated and no
Git history was rewritten.

---

## 1. Service architecture (verified in the repository)

| Component | Path | Port | Database | Responsibility |
| --- | --- | --- | --- | --- |
| auth-service | `backend/auth-service` | 5001 | `auth_db` | Registration, login, OTP email verification, password reset, MFA/TOTP, refresh-token rotation with reuse detection, access-token revocation, internal user introspection |
| user-service | `backend/user-service` | 5002 | `user_db` | Profiles, wallets, double-entry ledger, transfers, Chapa deposits and webhooks, reconciliation, policies/tier limits, beneficiaries, scheduled transfers, statements, disputes, admin actions, transactional outbox |
| kyc-service | `backend/kyc-service` | 5003 | `kyc_db` | Didit sessions, document upload/storage and OCR data, officer review, approval/revocation, re-verification sweeps, outbox |
| notification-service | `backend/notification-service` | 5004 | `notification_db` | In-app notifications, Brevo email queue and retries |
| frontend | `frontend` | 80/443 (80 in dev) | — | React 19 + Vite SPA served by Nginx, which also proxies `/api/*` |
| postgres | `docker-compose.yml` | 5432 (internal) | all four | PostgreSQL 16 |
| redis | `docker-compose.yml` | 6379 (internal) | — | Shared rate-limit windows and short-TTL KYC status cache; not a source of truth |
| monitoring (optional) | `monitoring/` | internal | — | Prometheus, Alertmanager, alert relay |

Service-to-service calls use Docker DNS names and a shared
`X-Internal-Service-Key` (timing-safe comparison). The internal endpoints are
also blocked at Nginx for browser traffic. Chapa, Didit and Brevo are the only
external integrations.

Background work:

- Outbox dispatchers (auth/user/kyc) — claim rows with `FOR UPDATE SKIP LOCKED`.
- Scheduled-transfer worker (user) — idempotency key per schedule run time.
- Reconciliation and ledger verification (user), KYC re-verification (kyc),
  email queue (notification) — timers inside the API process, gated by
  `ENABLE_JOBS` / `EMAIL_ENABLED`.

---

## 2. Credential exposure audit

Method: tracked-file listing, `.gitignore` checks, `git log -S` across all
refs, and full-history blob scans for provider key prefixes (Chapa, Didit,
Brevo, generic live/test prefixes).

| Check | Result |
| --- | --- |
| Root `.env` | Untracked and ignored; never appears in history |
| `frontend/.env` | Ignored today. It was tracked in early commits (`b591ccb`, `f7f8d7d`) and removed in `9505172`. Historical content was only `VITE_*` API base URLs pointing at localhost |
| `backend/*/.env` | All ignored and untracked |
| `.env.example` files | Tracked, placeholder values only (`JWT_SECRET=`, `BREVO_API_KEY=`, `CHAPA_SECRET_KEY=`, …) |
| Certificates/keys | `certs/`, `certbot/`, `*.pem`, `*.key` ignored and untracked |
| Provider key literals in history | 0 hits for `CHASECK-…`, `DIDIT…`, `xkeysib-…`, `xsmtpsib-…` |
| Hardcoded secrets in source | None found; providers read from `env` |
| Remote branches | `origin/dev` and `origin/main` match the audited local refs; no additional branches expose secrets |

Residual risk: the untracked root `.env` and per-service `.env` files contain
live-looking provider keys in plaintext on the development machine. They were
never committed. Rotate them before production and keep them out of backups
that leave the host. Masked evidence only, for example `CHASECK-****` and
`xkeysib-****`.

No Git history rewrite is recommended, because there is no committed secret to
purge.

---

## 3. Findings fixed in this audit

1. **Redis readiness never connected.** No service opened the Redis handshake
   at boot, so `/ready` reported `connected:false` even with Redis healthy.
   Every `server.js` now starts the handshake in the background without
   blocking startup and warns only in production when `REDIS_URL` is unset.
2. **KYC cache spec failed in CI without Redis.** The spec asserted a live
   Redis; it now skips when `REDIS_URL` is unset and shuts the client down
   safely.
3. **Shared-store outage was invisible.** Added the
   `SharedRateLimitStoreUnavailable` Prometheus alert for the security event
   emitted when the Redis limiter falls back to per-process counting.
4. **Brevo API call had no timeout.** The auth-service OTP/security-alert mail
   path now aborts after 10 seconds (API) and uses a 10-second SMTP socket
   timeout, matching the notification service.
5. **Upload volume ownership.** `user_uploads` could be root-owned (created by
   an older image), making avatar writes fail with `EACCES` for the `node`
   user. `user-service` and `kyc-service` now run a tiny root entrypoint that
   repairs volume ownership and then drops to `node` via `su-exec`.
6. **CRLF risk for container scripts.** Added `.gitattributes` so shell
   entrypoints and Compose/YAML files stay LF on Windows checkouts.
7. **Test database setup was manual and stale.** Added
   `scripts/create-test-databases.sh`, which creates and migrates
   `auth_test`, `user_test`, `kyc_test` and `notification_test` against the dev
   Compose stack, and referenced it from the README and testing guide.
8. **Nginx upstream re-resolution.** Verified the existing resolver-based
   configuration against a real IP change (see §5); documented the behavior.

---

## 4. Verified controls

- Helmet CSP/headers and HSTS, strict CORS without wildcard origins, JSON body
  limits, global and per-route rate limits, proxy trust bound to the configured
  hop count.
- JWT access/refresh tokens; refresh rotation with family reuse detection,
  absolute family expiry, access-token denylist and `tokenValidAfter`.
- Passwords hashed with bcrypt (`BCRYPT_ROUNDS`, validated in production);
  MFA secrets encrypted with `MFA_ENCRYPTION_KEY`.
- RBAC: customer/officer/admin routes separated; admin and officer guards
  applied at the router; internal routes require the shared key.
- KYC documents are encrypted at rest (`.enc`), served only through
  authenticated ownership-scoped routes with `Cache-Control: private, no-store`
  and `Content-Security-Policy: sandbox`; magic-byte validation on uploads.
- Chapa webhooks verify HMAC-SHA256 over the raw body with a 64-hex signature
  and `timingSafeEqual`; Didit supports v2/raw/simple signatures with timestamp
  validation and previous-secret rotation. Both deduplicate events.
- Financial postings use `Prisma.Decimal`/minor units, `FOR UPDATE` locks,
  `$transaction`, idempotency keys, reversal entries, and a scheduled ledger
  verification job.
- Structured logs redact authorization headers, cookies, passwords, tokens, OTP
  and security answers.
- Outbox uses `SKIP LOCKED` and leases; reconciliation records mismatches
  without crediting.

---

## 5. Nginx container-recreation test

Procedure on the local Compose stack:

1. Confirmed `/api/auth/health` returned 200 through Nginx.
2. Forced auth-service onto a new container IP (old IP held by a throw-away
   container) while Nginx stayed up.
3. Polled through Nginx every 500 ms.

Result: one transient 502 during the container start, then 200 for the rest of
the run (40+ requests) with no Nginx restart. Docker's embedded resolver
(`127.0.0.11`, `valid=10s`) plus variable `proxy_pass` re-resolves the new IP.
No container IP is hardcoded.

Note: `docker network disconnect/connect` is not a valid simulation — it breaks
the container's DNS registration and port publishing. Use container
recreation or an IP-holding helper container instead.

---

## 6. Remaining gaps and risks

- **AML / sanctions / PEP / suspicious-transaction / fraud detection are not
  implemented.** There is no screening provider, case management or SAR
  workflow. Do not represent the platform as compliant.
- **Background jobs are single-owner by deployment, not by lock.** Scheduled
  transfers and the email queue have no cross-process claim; running two
  replicas would duplicate attempts (the ledger still prevents a double debit
  via the idempotency key). Keep `ENABLE_JOBS=true` on exactly one user/kyc
  container and run one notification container, or add a queue with a claim
  before scaling out.
- **No withdrawal payout provider.** Chapa is used for deposits (Test Mode);
  withdrawals are recorded but not settled externally.
- **Email retry state is per notification row**, not a durable queue; a replica
  can double-send during a restart overlap.
- **KYC storage is a local named volume** with encryption at rest; it has no
  object-store replication or lifecycle retention policy. Back it up with
  `scripts/backup.sh`.
- **No browser end-to-end suite.** Frontend verification is unit-level
  (`node:test`) plus manual/browser smoke checks.
- **Branch reconciliation is pending.** `dev` is 85 commits ahead of
  `origin/main`; `origin/main` adds only `SECURITY.md`. Merge `origin/main`
  into `dev` (or cherry-pick `SECURITY.md`) and open a PR `dev → main`. Local
  `main` is stale; do not force-push.
- **Dependency advisories** flagged by Dependabot on `main` should be reviewed
  before production.

---

## 7. Test execution (2026-11-04)

| Suite | Command | Result |
| --- | --- | --- |
| auth-service | `npm test` | 79 tests, 78 pass, 1 skip (Redis-backed spec), 0 fail |
| user-service | `npm run test:all` against fresh `user_audit3_test` + `kyc_audit3_test` | 218 tests, 212 pass, 6 skip, 0 fail |
| kyc-service | `npm test` against migrated `kyc_test` | 95 tests, 94 pass, 1 skip, 0 fail |
| notification-service | `npm test` against migrated `notification_test` | 19 tests, 18 pass, 1 skip, 0 fail |
| Redis-bound specs | `test:rate-limit-store` (user, kyc, notification) and `test:kyc-cache` (user) against the dev Redis | 17 tests, 17 pass, 0 fail |
| frontend | `npm test`, `npm run lint`, `npm run build` | 11 tests pass; lint clean; production build succeeds |
| formatting | `prettier --check` on changed sources/docs | clean |

Container health checks for auth, user, KYC, notification and frontend all
reported healthy after the rebuild. No test touched production data or the real
Chapa/Didit/Brevo endpoints.

---

## 8. Deployment readiness (single Ubuntu VPS)


The production Compose file publishes only the frontend ports, keeps backends
and PostgreSQL on a private network, requires explicit production secrets, runs
non-root service containers, and defines health checks, named volumes and
restart policies. The deployment guide covers TLS, migrations, backups and
rollback.

```bash
# On the VPS, from the repository root
cp .env.production.example .env
# Fill every required value in .env (do not reuse development secrets)

docker compose build
docker compose up -d postgres redis
docker compose up -d auth-migrate user-migrate kyc-migrate notification-migrate
docker compose up -d auth-service user-service kyc-service notification-service
docker compose up -d frontend

curl -fsS https://bank.example.com/api/auth/health
curl -fsS https://bank.example.com/healthz
```

Before real financial production use: replace every development credential,
enable provider production keys only after sandbox sign-off, implement AML and
fraud controls, add a payout provider, and move background work to a single
owner or a durable queue.
