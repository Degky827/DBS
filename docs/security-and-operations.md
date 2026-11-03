# Security Controls and Operations

This document records the security controls that exist in the code today, how
they are configured, how to operate and rotate them, and which controls are
**not** implemented. It is intentionally descriptive, not aspirational: every
item below can be traced to a file or command in this repository.

Related documents: [environment-setup.md](./environment-setup.md) (every
environment variable), [deployment-guide.md](./deployment-guide.md),
[backup-and-recovery.md](./backup-and-recovery.md),
[testing-guide.md](./testing-guide.md).

---

## 1. Authentication and session model

| Control | Implementation | Notes |
|---|---|---|
| Password storage | bcrypt via `backend/auth-service/src/utils/password.util.js`, cost from `BCRYPT_ROUNDS` | Passwords never logged or returned |
| OTP storage | bcrypt hash (`otp.util.js`) | Plain OTP exists only in the email and the request |
| Access token | JWT, 15-minute default (`ACCESS_TOKEN_TTL`), HS256 or RS256, with `jti` and `sid` claims | Held in Redux memory only; never `localStorage`/`sessionStorage` |
| Access-token revocation | `jti` denylist (`AccessTokenRevocation`), `User.tokenValidAfter`, and refresh-family liveness; downstream services introspect tokens that carry `sid` and fail closed when auth-service is unreachable | Logout and password resets invalidate outstanding access tokens immediately |
| Refresh token | 48 random bytes; only SHA-256 hash stored (`refreshToken.util.js`) | `HttpOnly`, `SameSite=Lax`, path-scoped cookie |
| Refresh rotation | Every refresh issues a new token and revokes the old one | Token families tracked in `RefreshSession`; each family carries `familyExpiresAt` |
| Absolute session lifetime | `REFRESH_TOKEN_ABSOLUTE_TTL_MS` (default 30 days) caps the whole family | Sliding expiry (`REFRESH_TOKEN_TTL_MS`) cannot extend past the absolute deadline |
| Reuse detection | Reuse outside `REFRESH_TOKEN_GRACE_MS` (30 s) revokes the whole family | Concurrent refresh inside the grace window returns `409 REFRESH_RACE` |
| Logout | Revokes the family, denylists the presented access-token `jti`, and clears the cookie | Idempotent |
| JWT verification | Algorithm pinned per key type; `alg: none` rejected | Verifiers refuse HS256 when configured for RS256 |
| Internal service auth | Shared `INTERNAL_SERVICE_KEY` compared with `crypto.timingSafeEqual` | Used for KYC status lookups and `POST /internal/tokens/introspect` |

The frontend stores the access token only in Redux state. A page reload performs
one silent refresh; the cookie is the only durable credential.

## 2. CSRF and CORS

- **Trusted origin**: `refresh` and `logout` require an `Origin`/`Referer`
  matching an entry in `CORS_ORIGINS` (`requireTrustedOrigin.js`). Missing or
  mismatched origins are rejected with `403`.
- **Cookie scope**: `SameSite=Lax`, `Secure` required in production, `Path`
  limited to the auth API.
- **CORS**: explicit allowlist only. Wildcards are rejected at startup. Only
  auth-service sets `credentials: true`; user-service and KYC-service accept
  bearer/internal credentials, not cookies.
- Non-browser clients that send no `Origin` are unaffected by CORS but are
  still subject to authentication and CSRF checks on cookie endpoints.

## 3. HTTP security headers

API services (all three) use Helmet with a locked-down CSP:
`default-src 'none'`, no scripts, styles, images, frames, or forms. Swagger
routes install a narrowly scoped relaxed policy in `apiDocsSecurity.js`.
Additional headers: `X-Content-Type-Options: nosniff`,
`Referrer-Policy: no-referrer`, frame denial, and conditional HSTS
(`ENABLE_HSTS`). The SPA is served by Nginx in
[frontend/nginx.conf](../frontend/nginx.conf) with its own CSP
(`script-src 'self'`), HSTS, COOP/CORP, and `Permissions-Policy`.

The production image terminates TLS itself when `certs/tls.crt` and
`certs/tls.key` are mounted; the entrypoint selects
[frontend/nginx.http.conf](../frontend/nginx.http.conf) otherwise. TLS 1.2 and
1.3 are enabled, session tickets are disabled, and HTTP redirects to HTTPS
except for `/healthz` and ACME challenges. See
[deployment-guide.md](deployment-guide.md#6-tls-certificates).

HSTS is emitted by Nginx when either the direct connection or
`X-Forwarded-Proto` is HTTPS. Behind a TLS-terminating load balancer, set
`TRUST_PROXY=1` on the Node services and forward `X-Forwarded-Proto: https`.

## 4. Rate limiting

All limits use `express-rate-limit` with `draft-7` headers and a `Retry-After`
response header. Health and readiness probes are exempt.

| Limiter | Default | Scope | Env var |
|---|---|---|---|
| Global | 300 / 15 min | Per IP, all routes | `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS` |
| Login | 10 / 15 min | Per IP **and** email; successful logins not counted | `LOGIN_RATE_LIMIT_MAX` |
| Sensitive auth | 20 / 15 min | Per IP (register, verify, resend, forgot/reset) | `SENSITIVE_AUTH_RATE_LIMIT_MAX` |
| Refresh | 60 / 15 min | Per IP | `REFRESH_RATE_LIMIT_MAX` |
| Provider webhooks | 120 / 15 min | Per IP, dedicated budget for unauthenticated callbacks | `WEBHOOK_RATE_LIMIT_MAX` (user and KYC services) |

`AUTH_RATE_LIMIT_MAX` can raise the sensitive-auth budget where the deployment
sits behind a trusted shared NAT. Do not raise login limits as a workaround for
shared IPs — use the per-IP+email key instead.

**Limitation:** the counters are in-process. Multiple replicas each keep their
own budget, and a restart clears them. Distributing limits requires a shared
store (Redis), which is not currently an application dependency (see
[environment-setup.md](./environment-setup.md), section 10).

## 5. Secrets and configuration

Production startup **fails** rather than degrading when:

- `JWT_SECRET` / `INTERNAL_SERVICE_KEY` are missing, short, or known default
  values;
- `STORAGE_ENCRYPTION_KEY` is not 64 hex characters (KYC);
- `CORS_ORIGIN` contains HTTP, wildcards, or is missing;
- cookies would be insecure (non-`Secure` in production);
- `AUTH_MODE=dev` under `NODE_ENV=production`;
- `BREVO_API_KEY` is missing or does not match `EMAIL_TRANSPORT` (email
  verification and password reset cannot work without it);
- Chapa variables are partially configured or the base URL is not the pinned
  `https://api.chapa.global`;
- Didit variables are partially configured or the origin is not pinned.

Secrets are read from the process environment or, when `<NAME>_FILE` is set,
from the file it points to. The file value takes precedence over the plain
variable, so Compose secrets and Kubernetes secret volumes work without
exposing values in `docker inspect`. A missing or unreadable file aborts
startup. `docs/environment-setup.md` lists each variable, its format, whether
it is secret, and which services must share the same value
(`INTERNAL_SERVICE_KEY`, `JWT_PUBLIC_KEY_BASE64`).

### Secret rotation

These are documented procedures; the KYC re-encryption job is the only
automated rotation step.

**JWT signing key (HS256)**

1. Set `MFA_ENCRYPTION_KEY` **before** rotating JWT material. When it is unset,
   enrolled MFA secrets and recovery codes are derived from `JWT_SECRET` /
   `JWT_PRIVATE_KEY`; rotating those values makes existing enrolments
   unreadable.
2. Generate a new secret (`openssl rand -hex 64`).
3. Deploy it to auth-service only. Access tokens signed with the old secret
   expire within `ACCESS_TOKEN_TTL` (default 15 min).
4. Refresh tokens are opaque and unaffected; users stay signed in.
5. Zero-downtime alternative: issue tokens signed with a new `kid`, run
   auth-service with both keys, then remove the old key after the access-token
   TTL. The current build accepts one signing key at a time, so this requires
   running two auth-service instances during the overlap.

**JWT key pair (RS256)**

1. Generate a new key pair; publish the new public key to all three services.
2. Rotate the auth-service private key. Verifiers accept the previous public
   key until its access tokens expire.
3. Remove the old public key after `ACCESS_TOKEN_TTL`.

**`INTERNAL_SERVICE_KEY`**

Used by user-service → KYC-service and (where configured) audit calls. Rotating
it requires updating all services that share it in the same deployment window;
there is no dual-key acceptance, so expect a brief window of failed internal
calls if services roll at different times. Rotate during a maintenance window.

**`MFA_ENCRYPTION_KEY`**

A 64-hex-key used for AES-256-GCM encryption of TOTP secrets and HMAC hashing
of recovery codes. Set it at first deployment and keep it stable. Changing or
adding the key after users have enrolled makes their TOTP secret and recovery
codes unreadable; those users must re-enroll, or an administrator can reset MFA
(`POST /api/v1/admin/users/:userId/mfa/reset`). The key is independent of JWT
material, so setting it decouples MFA from JWT secret rotation.

**`STORAGE_ENCRYPTION_KEY`**

Encrypts KYC documents and extracted provider data with AES-256-GCM. The
service supports a keyring: `STORAGE_ENCRYPTION_KEY` is used for all new
writes, while `STORAGE_ENCRYPTION_KEYS_PREVIOUS` (comma-separated 64-hex keys)
is tried for reads. This allows zero-downtime rotation:

1. Generate a new key (`openssl rand -hex 32`).
2. Set the old key in `STORAGE_ENCRYPTION_KEYS_PREVIOUS`, set the new key as
   `STORAGE_ENCRYPTION_KEY`, and restart kyc-service. Reads keep working; new
   writes use the new key.
3. Dry-run the re-encryption job, then run it:
   ```bash
   docker compose exec kyc-service node scripts/rotateEncryptionKey.js --dry-run
   docker compose exec kyc-service node scripts/rotateEncryptionKey.js
   ```
   The job rewrites encrypted document files atomically and re-encrypts
   `ocrText`, `extractedData`, and provider session URLs. It is idempotent; a
   non-zero exit or any failure in the summary must be investigated before
   proceeding.
4. After a clean run, remove the old key from
   `STORAGE_ENCRYPTION_KEYS_PREVIOUS` and restart. Keep an offline backup of the
   old key until the next backup restore drill passes.

The startup check rejects a previous key that duplicates the current key or is
not exactly 64 hex characters.

**Brevo / Didit / Chapa credentials**

Rotate at the provider, then update `.env` and restart the affected service.
Chapa webhook secret rotation must match the provider dashboard value before
the next webhook arrives. For Didit, publish the new signing secret as
`DIDIT_WEBHOOK_SECRET` and keep the old value in
`DIDIT_WEBHOOK_SECRET_PREVIOUS` until in-flight webhooks have drained, then
remove the previous value.

**Database password**

`POSTGRES_PASSWORD` feeds the `DATABASE_URL` of every service. Rotate by
updating the role password and every service's connection string together; a
rolling restart will produce connection errors in between.

## 6. KYC enforcement (financial gate)

Wallet creation and money movement require an approved KYC decision:

- user-service calls KYC-service's internal status endpoint over HTTP using
  `INTERNAL_SERVICE_KEY`.
- The check is **fail-closed**: if KYC-service is unreachable, times out, or
  returns anything other than an approved decision, the operation is denied.
- The JWT `sub` is the KYC identity; profile IDs are not unified with auth IDs
  (see Limitations).
- Approval is stored in KYC-service and reported by the internal endpoint; the
  cross-service contract is exercised by
  `backend/user-service/tests/kycService.integration.test.js` (live KYC service,
  no mocks).

Officer review prevents self-review: an officer cannot approve their own
submission.

Approvals have an explicit lifecycle:

- An approval records `approvedAt` and `approvalExpiresAt`
  (`KYC_APPROVAL_TTL_DAYS`, default 365). Expired approvals report
  `effectiveStatus: EXPIRED` and `isApproved: false`, so they no longer satisfy
  the financial gate.
- An officer can revoke an approval (`POST
  /officer/submissions/{submissionId}/revoke`), which moves the submission to
  `NEEDS_RESUBMISSION` and is written to the review and audit history.
- A provider `Expired` webhook also revokes an `APPROVED` submission.
- Resubmission starts a fresh Didit session instead of reusing stale provider
  or comparison data. Duplicate submission creation is idempotent while a draft
  exists, conflicts while an application is in progress or validly approved,
  and starts a new application after expiry, revocation, or rejection.

## 7. Ledger integrity

The financial ledger is protected at the database layer, not only in
application code:

- Wallet balance `CHECK (balance >= 0)`, ETB-only currency checks.
- Journal entries must have at least two postings, balanced debits/credits, and
  one currency (enforced by trigger).
- Journal entries, postings, and reversals are **immutable** (triggers raise on
  update/delete).
- Transaction financial fields are immutable; reversal totals must match
  `reversedAmount`; a fully reversed transaction must be `REVERSED`.
- A payment cannot move to `COMPLETED` without a ledger entry.
- Wallet balance projection is checked against the ledger balance.
- Transfers run in `SERIALIZABLE` transactions with idempotency keys.
- Daily limits serialize concurrent requests per user and business day with
  advisory locks. Deposits count `PENDING` and `COMPLETED` payments and are
  re-checked at credit time; reversed transfers reduce their daily usage.
- Wallet history nets partial and full reversals (including refunded fees) and
  deposit fees; transaction detail lists the linked reversals.
- `npm run ledger:verify` audits postings, balances, and reversals against the
  database.

`ledger:verify` is the operational integrity check. Run it after any incident,
migration, or restore.

### Verification runs and issues

The same 33 read-only checks are available as a scheduled job, a CLI command and
an admin API, so a failure means the same thing whichever door you came in
through. They are aggregate SQL queries against the ledger tables — no
application-side scan of every posting — and money is compared in exact decimal,
never floating point.

- **Run verdicts.** `PASSED` means every check completed and the current open
  finding set has no `CRITICAL` or `HIGH`. `FAILED` means it does. `ERROR` means
  at least one check could not execute — the books are *unproven*, which is why
  an `ERROR` run also pages. `LOW` findings (for example development
  `TEST_FUNDING` entries) are reported and never fail a run.
- **Issue lifecycle.** A finding is `OPEN` until a reviewer `acknowledge`s it,
  `resolve`s it with a note, or `suppress`es it with a note. Reopening is
  ADMIN-only, as is suppression: those two actions change what the bank is
  willing to ignore. Suppressing does not make the books consistent — the run
  that recorded it still reports `FAILED`. Corrections are always reversal or
  adjustment entries; a historical journal entry is never edited, and the
  database triggers reject the attempt.
- **Deduplication.** A rerun does not re-record a finding that is already
  `OPEN`, `ACKNOWLEDGED` or `SUPPRESSED`; the partial unique index on
  (classification, aggregate type, aggregate id) is the arbiter, so concurrent
  runs cannot open the same finding twice. Only newly detected CRITICAL/HIGH
  findings, or check errors, raise an alert — so a finding nobody resolves
  surfaces once, not every cycle.
- **Alerting.** A failing run enqueues a `ledger.integrity_failed` event in the
  same transaction that records the run and its issues, then the outbox
  dispatcher delivers it to notification-service, which emails every active
  ADMIN (§14). The email and the database state therefore agree: a rolled-back
  run cannot leave an alert behind.
- **History.** `LedgerVerificationRun` rows keep the trigger (`SCHEDULED`,
  `MANUAL`, `CI`), duration, counts, per-severity summary and totals;
  `LedgerVerificationIssue` rows keep expected/actual/difference and status.
  Nothing in the admin view is estimated or mocked — it reads these tables.
  Runs left `RUNNING` by a crashed process are reaped to `ERROR` at the start of
  the next cycle.

Endpoints (ADMIN or FINANCIAL_OFFICER; suppression/reopening ADMIN-only):

| Method | Path |
| --- | --- |
| GET | `/api/v1/admin/ledger/integrity` |
| GET | `/api/v1/admin/ledger/verification/runs` |
| POST | `/api/v1/admin/ledger/verification/runs` |
| GET | `/api/v1/admin/ledger/verification/runs/{reference}` |
| GET | `/api/v1/admin/ledger/verification/issues` |
| POST | `/api/v1/admin/ledger/verification/issues/{id}/acknowledge` |
| POST | `/api/v1/admin/ledger/verification/issues/{id}/resolve` |
| POST | `/api/v1/admin/ledger/verification/issues/{id}/suppress` |
| POST | `/api/v1/admin/ledger/verification/issues/{id}/reopen` |

The job is enabled by default in production (`LEDGER_VERIFICATION_ENABLED`,
`LEDGER_VERIFICATION_INTERVAL_MS`, default six hours) and can be triggered by an
operator at any time. `npm run ledger:verify -- --json`, `--group
<entries|accounts|transactions|withdrawals|payouts>` and `--record` cover
read-only triage and an officially recorded run from the command line.

These checks detect internal inconsistency. They are not an AML or sanctions
screen, and passing them is not evidence of regulatory compliance.

## 8. Provider security

- **Chapa**: base URL pinned to `https://api.chapa.global`; only
  `CHASECK_TEST-*`/`CHAPA_TEST_*` credentials accepted; webhook HMAC-SHA256 verified with
  `timingSafeEqual` over the raw body; deposits disabled when unconfigured;
  reconciliation records persisted. Unrecognized provider statuses are reported
  as `PAYMENT_STATUS_UNKNOWN` and classified as `MANUAL_REVIEW` instead of being
  silently treated as pending.
- **Didit**: API origin pinned; webhook signature verified (HMAC-SHA256,
  timing-safe); status mapping is explicit and unknown statuses do not approve.
- **Brevo**: REST or SMTP key format validated; transport must match key type.
- No provider secret is logged. Log redaction covers authorization, cookie,
  and internal-key headers (see §9).

## 9. Logging and redaction

- Structured JSON logs via Pino in all three services.
- Redaction removes authorization and cookie headers, internal/dev API keys,
  passwords, tokens, OTPs, security answers, and their hashes. Values are
  replaced with `[REDACTED]`.
- Request logs contain method, URL, status, request ID, and IP only.
- `X-Request-Id` is accepted only when it matches `[A-Za-z0-9._-]{1,64}`,
  otherwise a UUID is generated.
- Health, readiness, and `/metrics` scrapes are excluded from access logs.

Logs are written to stdout/stderr and collected by Docker. **There is no
centralized log aggregation, retention policy, or alerting** in this
repository.

## 10. Monitoring and alerting

Every service exposes Prometheus metrics at `GET /metrics` on its private port.
The endpoint is registered before the global rate limiter and is excluded from
access logs. It is not published through Nginx, so it is reachable only from the
Compose backend network. Set `METRICS_TOKEN` on the services to additionally
require `Authorization: Bearer <token>` (or `X-Metrics-Token`).

Exported series:

- `banking_http_requests_total{service,method,route,status}` — request counter.
  Unmatched routes are grouped under `route="unmatched"` to bound cardinality.
- `banking_http_request_duration_seconds` — latency histogram.
- `banking_readiness` — `1` while the readiness probe passes, `0` when a
  dependency check fails.
- `banking_security_events_total{service,event}` — one increment per audit
  event (login failures, MFA failures, refresh-token reuse, account changes).
- `banking_kyc_provider_failures_total{operation}` — Didit call failures.
- `banking_kyc_webhook_events_total{result}` — `applied`, `ignored`,
  `duplicate`, `accepted`, `rejected` (signature/timestamp), or `error`.
- `banking_payment_reconciliation_total{outcome}` — `MATCHED`, `PENDING`,
  `MISMATCH`, `MANUAL_REVIEW`, or `ERROR`.
- `banking_ledger_verification_runs_total{outcome}` — `passed`, `failed`, or
  `error` per completed verification run (§7).
- `banking_ledger_open_issues{severity}` — actionable OPEN/ACKNOWLEDGED ledger
  findings. Every severity is exported on each refresh, including zeroes, so an
  alert clears when the backlog drains instead of vanishing with the series.
  Suppressed findings are excluded here while their run still reports `FAILED`.
- `banking_ledger_verification_last_run_timestamp_seconds` — unix time of the
  last completed run; used to prove the job is still running at all.
- Process metrics: CPU, RSS, heap, event-loop lag, and service info.

The opt-in monitoring profile runs Prometheus, Alertmanager, and an alert relay:

```bash
docker compose --profile monitoring up -d
```

- `monitoring/prometheus/prometheus.yml` scrapes auth-service:5001,
  user-service:5002, and kyc-service:5003 every 15 seconds.
- `monitoring/prometheus/alerts.yml` defines availability, HTTP, security, KYC,
  payment, ledger, and notification alerts: `ServiceDown`, `ServiceNotReady`,
  `HighServerErrorRate`, `HighRequestLatency`, `RateLimitSpike`,
  `LoginFailureBurst`, `MfaFailureBurst`, `RefreshTokenReuseDetected`,
  `KycProviderFailures`, `KycWebhookRejected`,
  `ReconciliationNeedsReview`, `LedgerIntegrityFindings`,
  `LedgerVerificationRunFailed`, `LedgerVerificationStale`, and
  `VerificationIssueBacklogGrowing`. `LedgerVerificationStale` exists because a
  silent job is indistinguishable from a healthy ledger: the absence of runs is
  itself an alert, not evidence of cleanliness. Validate rule changes with
  `promtool check rules monitoring/prometheus/alerts.yml`.
- `monitoring/alertmanager/alertmanager.yml` groups by alert and service and
  repeats critical alerts hourly. Every notification is delivered to
  `alert-relay`, which records it in `docker compose logs alert-relay`.
  Set `ALERT_SLACK_WEBHOOK_URL` and/or `ALERT_WEBHOOK_URL` to also forward
  alerts to Slack or a generic webhook; a failed forward makes Alertmanager
  retry. Keep the relay URL in sync if you change its port or service name.
- `monitoring/alert-relay` is a zero-dependency Node service with no published
  port; it is reachable only from the backend network.

Neither container publishes a host port. Use `docker compose exec prometheus
wget -qO- localhost:9090/-/healthy` or an SSH tunnel to reach the UI.

### Requiring a metrics token

If the metrics endpoint may be reachable by an untrusted container, create a
token and enable it consistently:

1. Add `METRICS_TOKEN=$(openssl rand -hex 32)` to `.env`.
2. Write it for Prometheus:
   `printf '%s' "$METRICS_TOKEN" > monitoring/secrets/metrics_token`
   (the directory is gitignored).
3. Uncomment `bearer_token_file: /etc/prometheus-secrets/metrics_token` in each
   service job in `monitoring/prometheus/prometheus.yml`.
4. Recreate the services and Prometheus:
   `docker compose up -d --force-recreate auth-service user-service kyc-service`
   then `docker compose --profile monitoring up -d`.

A request without the token receives `401` and is not counted in HTTP metrics.

### Still absent

APM/tracing, pre-built Grafana dashboards, centralized log aggregation,
external uptime checks, and an on-call rotation are not included. Long-term
metrics storage is limited by `PROMETHEUS_RETENTION` (default `15d`); ship
scrapes to a durable remote-write endpoint for longer retention. Alert
notifications are recorded by `alert-relay` by default; forwarding to a paging
provider requires `ALERT_WEBHOOK_URL` or a receiver change in
`monitoring/alertmanager/alertmanager.yml`.

## 11. Incident response (documented runbook)

There is no on-call rotation or paging integration. The steps below are the
intended manual procedure.

1. **Contain** — if credentials are suspected compromised, rotate the relevant
   secret (§5) and revoke refresh sessions for affected users. Revoking a
   family forces re-authentication.
2. **Assess** — pull logs by `X-Request-Id`; run `ledger:verify`; check
   `GET /api/v1/admin/ledger/integrity` and the run history for the findings
   already known to reviewers (§7); check reconciliation records for Chapa and
   the KYC decision log.
3. **Preserve** — take a database snapshot before any remediation that writes
   data (see [backup-and-recovery.md](./backup-and-recovery.md)).
4. **Remediate** — fix forward with a new commit; never edit posted ledger rows
   (triggers forbid it). Use the reversal flow for financial corrections.
5. **Recover** — restore from backup only after confirming the backup's
   integrity with `ledger:verify` on the restored copy.
6. **Review** — record the timeline, root cause, and any control gaps; update
   this document.

For suspected data exposure, treat `STORAGE_ENCRYPTION_KEY`, database
credentials, and `JWT_SECRET` as compromised until proven otherwise.

## 12. Residual risks and open findings

These are known and **not** resolved by this audit:

| Risk | Impact | Mitigation status |
|---|---|---|
| No centralized/distributed rate limiting | Brute-force budget resets on restart and multiplies per replica | In-process only |
| No monitoring/alerting/on-call | Outages and fraud may go unnoticed | Prometheus rules + Alertmanager + alert relay (log/Slack/webhook); on-call rotation is deployment-specific |
| No penetration test or external security review | Unknown exploitable issues | Not performed |
| `STORAGE_ENCRYPTION_KEY` rotation lacks re-key tooling | Key compromise requires manual migration | Documented only |
| `INTERNAL_SERVICE_KEY` has no dual-key window | Rotation causes brief internal failures | Maintenance window |
| Profile IDs not unified with auth `sub` | Identity mapping complexity | Documented limitation |
| Pre-existing formatting debt | Untouched files are still unformatted | `format-check` gates changed sources only |
| Provider integrations only tested with mocks | Real sandbox behavior unverified | See [provider-integration-testing.md](./provider-integration-testing.md) |
| No browser end-to-end test suite | UI regressions may escape unit tests | Manual smoke only |

## 13. Security test coverage

Automated tests cover: JWT algorithm pinning and expiry, refresh rotation and
reuse revocation, access-token revocation and introspection, absolute
refresh-family expiry, grace-window race handling, trusted-origin CSRF checks,
CORS allowlisting, rate-limit behavior (including dedicated webhook budgets),
production startup validation (including the Brevo requirement), KYC gating
(live cross-service), KYC resubmission/approval expiry/revocation, officer
self-review prevention, webhook signature verification (Chapa and Didit),
document encryption, ledger concurrency/precision/atomicity, deposit daily
limits, reversal-aware history, reconciliation ambiguity handling, and reversal
invariants. Phase 3 adds outbox delivery and dead-letter replay, consumer
deduplication, inbox scoping by token subject, the email queue, beneficiaries,
scheduled transfers, statement balances and PDF export, and the dispute
transition matrix. Phase 4 adds the ledger verification suite: run verdicts
against injected inconsistencies, one-open-per-target deduplication, the
reviewer transition matrix including ADMIN-only suppression and reopening, alert
fan-out through the outbox, job single-flight, and abandoned-run reaping.
See [testing-guide.md](./testing-guide.md) for commands and counts.

## 14. Event outbox and notification delivery

### Delivery path

- user-service writes the business change and its `OutboxEvent` in the same
  Prisma transaction. An event exists only if the change committed, and a
  rolled-back change leaves no event behind. `outbox.enqueue()` is a no-op when
  `OUTBOX_ENABLED=false`, which is the default outside production.
- The dispatcher polls every `OUTBOX_INTERVAL_MS` (default 5 s) for unpublished
  events whose `nextAttemptAt` has passed and whose `attempts` are below
  `OUTBOX_MAX_ATTEMPTS` (default 12), delivers at most `OUTBOX_BATCH_SIZE`
  (default 25) per cycle with a 5-second request timeout, and doubles the retry
  delay on failure up to one hour. A single in-process run is guarded so cycles
  never overlap.
- `409` from the consumer means the `eventId` was already recorded and is treated
  as success, so a lost acknowledgement cannot produce a duplicate notification.
  Any other non-2xx response is a retryable failure.
- Events that exhaust `OUTBOX_MAX_ATTEMPTS` stop being polled and are counted as
  `dead_lettered`. They remain in the table with `lastError` and are replayed by
  an administrator from `/admin/outbox` (`POST /api/v1/admin/outbox/:eventId/replay`,
  `ADMIN` role only) after the consumer is healthy again.

### Consumer authentication and exposure

- `POST /api/v1/internal/notifications/events` requires `X-Internal-Service-Key`.
  The comparison is length-checked and `crypto.timingSafeEqual`; when
  `INTERNAL_SERVICE_KEY` is unset the route returns `403 INTERNAL_ENDPOINTS_DISABLED`
  rather than accepting unauthenticated writes. The route has its own limiter
  (`INTERNAL_RATE_LIMIT_MAX`).
- Nginx rejects any browser request that reaches an `/internal/` segment under
  `/api/auth`, `/api/user`, `/api/kyc`, or `/api/notifications`, so internal
  routes are reachable only from the container network.
- In-app reads use the same access-token material as the other services and,
  because `AUTH_SERVICE_URL` is required in production, introspect the token so a
  revoked session cannot read an inbox. Ownership is the lower-cased token email;
  queries are filtered by `recipientEmail`, so a valid token never returns another
  customer's notifications.

### Storage and email

- `ProcessedEvent.eventId` is the primary key and `Notification` has
  `@@unique([eventId, recipientEmail])`, so redelivery is idempotent per recipient.
- Email is optional: `EMAIL_ENABLED` defaults to true only when `BREVO_API_KEY`
  is present, `EMAIL_TRANSPORT` supports the Brevo API only, and
  `BREVO_API_BASE_URL` must be HTTPS. Notification bodies are HTML-escaped before
  they reach the provider, and the email worker gives up after
  `EMAIL_MAX_ATTEMPTS`.

### Related alerts

| Alert | Expression | Severity |
|---|---|---|
| OutboxDeliveryStalled | `banking_outbox_pending > 50` for 15m | warning |
| OutboxDeadLetters | `increase(banking_outbox_events_total{outcome="dead_lettered"}[15m]) > 0` | critical |
| NotificationEventDeliveryFailures | `increase(banking_notification_events_total{outcome="failed"}[10m]) > 3` for 5m | warning |
| NotificationEmailBacklog | `banking_notification_email_backlog > 25` for 15m | warning |

## 15. CI security gates

`.github/workflows/ci.yml` fails closed. Every third-party action is pinned to a
commit SHA, the workflow runs with `permissions: contents: read` by default, and
each job has a `timeout-minutes` budget.

| Gate | Behavior |
|---|---|
| `security-audit` | `npm audit --omit=dev --audit-level=moderate` and `npm audit --audit-level=high` per package (all four services plus the frontend). Both are blocking; there is no `continue-on-error`. |
| `format-check` | Prettier over the files changed between the run's base revision and `HEAD`. Legacy files are not reformatted retroactively. |
| `secrets-hygiene` | Fails when git tracks `.env` files, PEM/key/certificate material, `certs/`, `certbot/`, `backups/`, or `monitoring/secrets/*`, and when added lines match known credential formats (AWS access keys, GitHub tokens, Slack tokens, Google API keys, Stripe live keys, PEM private-key and certificate blocks). |
| `dependency-review` | Pull requests only; fails on newly added dependencies with high or critical advisories. |
| `scan-docker-images` | Builds each image and runs Trivy with `exit-code: 1` on CRITICAL and HIGH findings that have a fix available. |
| `codeql.yml` | CodeQL (`security-extended`) for JavaScript/TypeScript and GitHub Actions. Findings are uploaded to code scanning; a CRITICAL-scoring result fails the job. |
| `test-notification-service` | Lints, migrates, and runs the notification suite against a throw-away `notification_test` database. |

`all-checks-complete` aggregates every job and reports the result of each, so a
required check cannot be bypassed by a skipped dependency.

When a gate fails, fix the finding rather than relaxing the gate. If a
dependency advisory genuinely cannot be remediated yet, record it as a known
issue with an owner and a review date in §12.
