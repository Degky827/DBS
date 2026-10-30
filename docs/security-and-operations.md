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
| Access token | JWT, 15-minute default (`ACCESS_TOKEN_TTL`), HS256 or RS256 | Held in Redux memory only; never `localStorage`/`sessionStorage` |
| Refresh token | 48 random bytes; only SHA-256 hash stored (`refreshToken.util.js`) | `HttpOnly`, `SameSite=Lax`, path-scoped cookie |
| Refresh rotation | Every refresh issues a new token and revokes the old one | Token families tracked in `RefreshSession` |
| Reuse detection | Reuse outside `REFRESH_TOKEN_GRACE_MS` (30 s) revokes the whole family | Concurrent refresh inside the grace window returns `409 REFRESH_RACE` |
| Logout | Revokes the family and clears the cookie | Idempotent |
| JWT verification | Algorithm pinned per key type; `alg: none` rejected | Verifiers refuse HS256 when configured for RS256 |
| Internal service auth | Shared `INTERNAL_SERVICE_KEY` compared with `crypto.timingSafeEqual` | Used for KYC status lookups |

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

Secrets are read from the environment only. `docs/environment-setup.md` lists
each variable, its format, whether it is secret, and which services must share
the same value (`INTERNAL_SERVICE_KEY`, `JWT_PUBLIC_KEY_BASE64`).

### Secret rotation

These are documented procedures; no automation exists.

**JWT signing key (HS256)**

1. Generate a new secret (`openssl rand -hex 64`).
2. Deploy it to auth-service only. Access tokens signed with the old secret
   expire within `ACCESS_TOKEN_TTL` (default 15 min).
3. Refresh tokens are opaque and unaffected; users stay signed in.
4. Zero-downtime alternative: issue tokens signed with a new `kid`, run
   auth-service with both keys, then remove the old key after the access-token
   TTL.

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

**`STORAGE_ENCRYPTION_KEY`**

Encrypts KYC documents with AES-256-GCM. **Rotating it makes existing
documents unreadable** unless they are re-encrypted first. There is no re-key
tool in the repository. Treat this key as long-lived; if it is compromised,
plan an offline decrypt-with-old-key → encrypt-with-new-key migration before
changing the environment variable.

**Brevo / Didit / Chapa credentials**

Rotate at the provider, then update `.env` and restart the affected service.
Chapa webhook secret rotation must match the provider dashboard value before
the next webhook arrives. Didit webhook secrets are verified per request.

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
- `npm run ledger:verify` audits postings, balances, and reversals against the
  database.

`ledger:verify` is the operational integrity check. Run it after any incident,
migration, or restore.

## 8. Provider security

- **Chapa**: base URL pinned to `https://api.chapa.global`; only
  `CHAPA_TEST_*` credentials accepted; webhook HMAC-SHA256 verified with
  `timingSafeEqual` over the raw body; deposits disabled when unconfigured;
  reconciliation records persisted.
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
- Health and readiness probes are excluded from access logs.

Logs are written to stdout/stderr and collected by Docker. **There is no
centralized log aggregation, retention policy, or alerting** in this
repository.

## 10. Monitoring and alerting

What exists:

- `/api/v1/health` — liveness, no database access.
- `/api/v1/ready` — readiness, checks the database, returns `503` when down.
- Docker Compose health checks for PostgreSQL and all three services.
- `ledger:verify` for financial integrity.
- Payment reconciliation for stale Chapa payments.

What does **not** exist: metrics endpoint, APM/tracing, dashboards,
error-rate or latency alerts, uptime checks, log-based alarms, or on-call
routing. A production deployment must add these at the platform layer. At
minimum, alert on: readiness `503`, 5xx rate, login-limit `429` spikes, KYC
provider failures, webhook signature failures, and reconciliation mismatches.

## 11. Incident response (documented runbook)

There is no on-call rotation or paging integration. The steps below are the
intended manual procedure.

1. **Contain** — if credentials are suspected compromised, rotate the relevant
   secret (§5) and revoke refresh sessions for affected users. Revoking a
   family forces re-authentication.
2. **Assess** — pull logs by `X-Request-Id`; run `ledger:verify`; check
   reconciliation records for Chapa and the KYC decision log.
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
| No monitoring/alerting/on-call | Outages and fraud may go unnoticed | Health endpoints only |
| No penetration test or external security review | Unknown exploitable issues | Not performed |
| `STORAGE_ENCRYPTION_KEY` rotation lacks re-key tooling | Key compromise requires manual migration | Documented only |
| `INTERNAL_SERVICE_KEY` has no dual-key window | Rotation causes brief internal failures | Maintenance window |
| Profile IDs not unified with auth `sub` | Identity mapping complexity | Documented limitation |
| Pre-existing formatting debt | `format:check` fails (see readiness report) | Not auto-formatted |
| Provider integrations only tested with mocks | Real sandbox behavior unverified | See [provider-integration-testing.md](./provider-integration-testing.md) |
| No browser end-to-end test suite | UI regressions may escape unit tests | Manual smoke only |

## 13. Security test coverage

Automated tests cover: JWT algorithm pinning and expiry, refresh rotation and
reuse revocation, grace-window race handling, trusted-origin CSRF checks, CORS
allowlisting, rate-limit behavior, production startup validation (including
the Brevo requirement), KYC gating (live cross-service), officer self-review
prevention, webhook signature verification (Chapa and Didit), document
encryption, ledger concurrency/precision/atomicity, and reversal invariants.
See [testing-guide.md](./testing-guide.md) for commands and counts.
