# Production Readiness Report

**Project:** Meridian Digital Banking and Identity Verification Platform
**Date:** 2026-10-29
**Branch:** `audit/final-verification`
**HEAD:** `a60b900` (all audit changes are uncommitted in the working tree)
**Classification:** **DEVELOPMENT READY** — not staging ready, not production ready.

This report supersedes [phase4-final-report.md](./phase4-final-report.md) for
readiness decisions. It records only what was executed and observed. Nothing in
this document was inferred from a provider dashboard, a CI run, or a deployment
that did not happen.

---

## 1. Executive summary

The codebase passes its full automated suite locally, builds, lints, validates
all OpenAPI documents, and audits clean for known dependency vulnerabilities.
The ledger and its database invariants were exercised against a real PostgreSQL
instance, and a backup/restore cycle was rehearsed with integrity verification
on the restored copy.

It is **not** production ready. The blockers are external to unit-test coverage:

- no real provider call has been made (Brevo, Chapa, Didit);
- no CI workflow has run on GitHub (nothing was pushed);
- no deployment has been performed;
- there is no monitoring, alerting, or on-call capability;
- there has been no penetration test or security review;
- wallet withdrawals and payout-provider integration are incomplete;
- there is no browser end-to-end test suite.

The working tree contains a large uncommitted change set. Nothing was committed,
pushed, merged, deployed, or rotated during this audit.

---

## 2. Scope and constraints

The audit inspected the current branch, worktree, and history before changing
anything. Changes were limited to defects and gaps that could be verified in the
repository. The following constraints were applied throughout:

- No production customer data, no destructive production action, no real-money
  transaction.
- No secret values were printed, logged, committed, or written into any report.
- No real `.env` file is tracked; local `.env` files were preserved.
- Authentication, authorization, KYC gating, webhook verification, encryption,
  rate limiting, and ledger invariants were not weakened to make tests pass.
- Deletions required a reference check across code, scripts, Docker, CI, and
  documentation.
- Nothing was pushed, merged, deployed, or committed without approval.

---

## 3. Repository state

| Item | Value |
|---|---|
| Branch | `audit/final-verification` |
| HEAD | `a60b900` — `docs: document Phase 4 wallet and payment setup` |
| Tracked modifications | 109 files, +9,074 / −1,833 lines |
| Staged deletions | 3 files |
| Untracked files | 64 (new middleware, ledger module, migrations, tests, docs) |
| Remote push | None |
| Commits created | None |

The uncommitted set includes the Phase 2 security work, Phase 3 KYC gating,
Phase 5 ledger/payments work, the test suites, and the documentation in this
audit. A single commit would be large; split it by area before review (see §18).

---

## 4. Verification results

| Check | Command | Result |
|---|---|---|
| Auth tests | `npm test` (auth-service) | **52 pass**, 0 fail, 0 skip |
| User tests | `npm run test:all` with isolated test DBs | **113 pass**, 0 fail, 0 skip |
| KYC tests | `npm test` (kyc-service) | **51 pass**, 0 fail, 0 skip |
| Frontend tests | `npm test` (frontend) | **5 pass**, 0 fail, 0 skip |
| **Total** | | **221 pass**, 0 fail, 0 skip |
| Lint | `npm run lint` × 4 packages | Pass |
| Frontend build | `npm run build` | Pass (627.19 kB JS, 194.21 kB gzip; chunk-size warning) |
| OpenAPI | `swagger-cli validate` × 4 specs | All valid |
| Dependency audit | `npm audit` × 4 packages | 0 vulnerabilities |
| Compose config | `docker compose config -q` (prod and dev) | Both valid |
| Ledger verify | `npm run ledger:verify` | `OK: ledger integrity checks passed` |
| Backup/restore | `pg_dump` → `pg_restore` → verify | Identical counts; verify passes |
| Runtime smoke | health endpoints + SPA | Auth/user/KYC/SPA respond |

The user-service suite includes the five cross-service KYC tests because
`KYC_TEST_DATABASE_URL` was set. Without it those tests skip; CI now provisions
the database and sets the variable so they run.

---

## 5. Defects fixed during this audit

### 5.1 Runtime OpenAPI JSON was invalid

`backend/auth-service/docs/openapi.json` — the document actually served by
Swagger UI and `GET /api/v1/openapi.json` — contained OpenAPI 3.1 `"type":
"null"` schemas inside a 3.0.3 document. The earlier audit fixed only the YAML,
so the served document still failed validation.

Fix: replaced four occurrences with `{ "type": "object", "nullable": true }`.
CI now validates **both** `openapi.yaml` and `openapi.json`.

### 5.2 CI silently skipped the cross-service KYC tests

The user-service CI job had no KYC database and no `KYC_TEST_DATABASE_URL`, so
five tests skipped and the job still passed. The job now:

1. creates `kyc_test` in the service container;
2. installs and generates the KYC Prisma client;
3. runs KYC migrations against `kyc_test`;
4. sets `KYC_TEST_DATABASE_URL`.

A missing KYC database now fails the job instead of reducing coverage silently.

### 5.3 A real `.env` file was tracked

`frontend/.env` was committed. Its contents were only public localhost API URLs,
but tracking any `.env` violates the secret-handling rule and invites future
leakage.

Fix: `git rm --cached frontend/.env` (local file retained), `.gitignore`
expanded to ignore `node_modules/`, build output, coverage, logs, storage,
uploads, and editor files. `git check-ignore` confirms all four local `.env`
files are ignored.

### 5.4 Production could start without email delivery

`sendOtpEmail` returned `{ delivered: false }` with a warning when no Brevo key
was configured. In production this meant registration and password reset could
never complete, while the service reported healthy.

Fix: auth-service now fails at startup in production when `BREVO_API_KEY` is
missing, malformed, or inconsistent with `EMAIL_TRANSPORT`. Startup tests cover
the missing key, wrong prefix, and transport mismatch.

### 5.5 Known dependency advisories

`npm audit` reported 11 advisories in auth-service and 7 in user-service
(zod, qs, body-parser, Prisma transitive packages, nodemailer/smtp-server).
`npm audit fix` updated only the lockfiles; no direct dependency version was
changed. Audit now reports zero vulnerabilities in all four packages, and the
full suites were re-run afterwards.

### 5.6 Repository cleanup (not defects)

- `backend/kyc-service/eng.traineddata` (5.2 MB) — no code, Docker, or script
  reference. Tesseract downloads the model on first use.
- `docs/phases.txt` — obsolete planning note with no references.

Both were removed after a repository-wide reference check.

---

## 6. Change inventory

| Area | Representative files | Nature |
|---|---|---|
| Auth security | `src/middlewares/{cors,requireTrustedOrigin,apiDocsAccess,apiDocsSecurity}.js`, `src/utils/cookie.util.js`, refresh migrations | New controls, tests |
| Auth config | `src/config/env.js`, `src/services/email.service.js` | Production fail-fast, Brevo validation |
| Auth docs | `docs/openapi.{yaml,json}` | Schema fix |
| User ledger | `src/modules/ledger/`, `prisma/verifyLedger.js`, double-entry migration | New ledger, triggers, verification |
| User payments | `src/modules/payments/` (Chapa adapter, reconciliation, withdrawals) | Provider integration, reconciliation |
| User KYC gate | `src/services/kycClient.js`, `kycEligibility.js`, `requireKycApproval.js`, `internalController` in KYC | Fail-closed gating |
| KYC service | `src/utils/secureStorage.js`, webhook signature, officer routes | Encryption, signed webhooks, review |
| Tests | `backend/*/tests/*.test.js`, `frontend/tests/*.test.js` | 221 tests |
| CI | `.github/workflows/ci.yml` | KYC DB provisioning, JSON validation |
| Compose | `docker-compose.yml`, `docker-compose.dev.yml` | Service wiring, health checks |
| Docs | `docs/*.md`, `README.md` | Environment, security, providers, readiness |
| Hygiene | `.gitignore`, deletions | Secret safety, dead files |

---

## 7. Tests

Commands actually run:

```bash
cd backend/auth-service && npm test
cd backend/kyc-service  && npm test
cd frontend             && npm test
cd backend/user-service && \
  WALLET_TEST_DATABASE_URL='postgresql://.../audit_user_1_test?schema=public' \
  KYC_TEST_DATABASE_URL='postgresql://.../audit_kyc_1_test?schema=public' \
  npm run test:all
```

Databases were isolated copies containing only test fixtures. The
user-service suite runs with `--test-concurrency=1` and exercises real
PostgreSQL transactions, triggers, serializable transfers, idempotency, and the
live cross-service KYC contract.

Coverage areas: JWT and refresh rotation/reuse, CSRF/trusted origin, CORS,
rate limits, production startup validation, password reset, email verification,
wallets, transfers, ledger and reversals, financial integrity, policies,
Chapa adapter and webhooks, reconciliation, KYC submissions/documents/
verification/review, and frontend session state.

**Not covered:** real provider calls, browser end-to-end flows, load/soak
testing, chaos/failure injection, and multi-replica rate limiting.

---

## 8. Static checks and build

- ESLint passes in auth-service, user-service, kyc-service, and frontend.
- Prettier `format:check` **fails** across all four packages: auth 48 files,
  user 62, kyc 60, frontend 39. This is pre-existing formatting debt, not
  introduced here. It was not auto-formatted because doing so would add a large
  noise diff to an already large uncommitted change set. CI's format step is
  non-blocking (`|| echo`), so this debt is currently invisible to CI.
- Frontend production build passes. The only warning is the 627 kB main chunk;
  route-level code splitting is a future optimization, not a correctness issue.

---

## 9. Database, ledger, and backup

All database work used disposable databases in the local PostgreSQL 16
container; no production database was touched.

- Migrations applied cleanly: auth 3, user 4, KYC 1 (on fresh databases).
- `ledger:verify` on the post-test audit database:

  ```
  journal entries : 276
  ledger accounts : 85
  wallets         : 75
  transactions    : 162 (LEGACY 3)
  reversals       : 18
  withdrawals     : 3
  payments        : 30
  OK: ledger integrity checks passed
  ```

- Backup/restore rehearsal: `pg_dump -Fc` from the audit database into a second
  disposable database with `pg_restore --no-owner`. Source and restored copies
  matched exactly:

  | Metric | Source | Restored |
  |---|---|---|
  | Journal entries | 276 | 276 |
  | Ledger postings | 561 | 561 |
  | Non-internal triggers | 11 | 11 |

  `ledger:verify` passes on the restored copy with the same report.

This proves the dump/restore mechanics and trigger preservation on a test
database. It does **not** prove encrypted backup storage, off-site retention,
or recovery time for a production-sized dataset.

---

## 10. Dependency audit

`npm audit` (including dev dependencies) reports
`{ info: 0, low: 0, moderate: 0, high: 0, critical: 0 }` for auth-service,
user-service, kyc-service, and frontend.

CI's audit job uses `|| true` and `continue-on-error`, so it reports but never
blocks. That is a policy choice, not a guarantee; consider failing on high and
critical advisories.

---

## 11. Environment configuration

Every variable, its format, whether it is secret, its default, and which
services must share a value is documented in
[environment-setup.md](./environment-setup.md). Summary of the current local
state (names only; no values were read into this report):

| Service | Configured | Notably absent |
|---|---|---|
| auth-service | DB, JWT, CORS, internal key, Brevo key, sender, rate limits | — |
| user-service | DB, JWT, internal key, KYC URL, CORS | **All `CHAPA_*`** (deposits disabled) |
| KYC service | DB, JWT, internal key, Didit key/workflow/webhook secret, storage key | — |
| Frontend | Build-time API bases (public) | — |

Missing or intentionally absent:

- **Chapa** — no test credentials, so external deposits are disabled and return
  `PAYMENT_PROVIDER_NOT_CONFIGURED`. This is the intended fail-closed behavior.
- **Payout provider** — withdrawals have ledger support but no payout
  integration; no provider is configured or implemented.
- **Redis / RabbitMQ / MinIO** — not consumed by application code and
  deliberately absent. Do not add them without a real integration.

`INTERNAL_SERVICE_KEY` must match across user-service and KYC-service.
`JWT_SECRET` (or the RS256 public key) must match across all three services.
Production startup rejects weak or missing secrets.

---

## 12. External providers

Full detail in
[provider-integration-testing.md](./provider-integration-testing.md).

| Provider | Credentials present | Automated tests | Real call made | Verified |
|---|---|---|---|---|
| Brevo | Yes | Yes (module stubbed) | **No** | **No** |
| Chapa | No | Yes (fetch injected) | **No** | **No** |
| Didit | Yes | Yes (fetch stubbed) | **No** | **No** |

No email was sent, no checkout was created, and no identity session was
submitted. A direct Brevo check was blocked by the execution environment's
command policy. Protocol-level behavior is covered by tests; provider-side
behavior is not. Treat all three as unverified until a sandbox run is recorded.

---

## 13. CI status

**Local equivalents of every CI job pass.** The workflow itself has **not run on
GitHub** because nothing was pushed and no approval to push was given.

Gaps observed in the workflow:

- Only the frontend is linted in the `lint` job; backend lint runs in each test
  job, so it is covered.
- Formatting is not enforced (`|| echo`).
- Dependency audit never fails the build (`|| true`, `continue-on-error`).
- The KYC OpenAPI generation step uses placeholder database credentials; it only
  imports the spec and does not connect, but this is brittle.
- Cross-service tests now run with a provisioned KYC database (fixed in §5.2).

Do not claim a green CI run until the workflow has actually executed.

---

## 14. Runtime smoke test

The user's development stack was left running and was not rebuilt or restarted.

| Endpoint | Result |
|---|---|
| `http://localhost:8080/` | 200 |
| `http://localhost:5001/api/v1/health` | 200 |
| `http://localhost:5002/api/v1/health` | 200 |
| `http://localhost:5003/api/v1/kyc/health` | 200 |
| `http://localhost:5001/api/v1/ready` | **404** |

The `/ready` 404 is a **stale container** artifact: the running auth-service
image was built on 2026-10-23, while the current source contains the readiness
route (verified by source inspection and unit tests). Rebuilding would restart
the user's stack, so it was not done. Rebuild and re-probe before treating the
readiness endpoint as operational.

---

## 15. Repository cleanup evidence

| Removed | Size | Reference check |
|---|---|---|
| `backend/kyc-service/eng.traineddata` | 5.2 MB | No import, Docker `COPY`, script, or doc reference; `createWorker("eng")` downloads it |
| `docs/phases.txt` | 21 lines | No reference in code, scripts, CI, or docs |
| `frontend/.env` (tracked copy only) | 3 lines | Local file retained and now gitignored; `.env.example` covers contributors |

No other file was deleted. No user-authored uncommitted work was discarded.

---

## 16. Security posture and open findings

Implemented controls are documented in
[security-and-operations.md](./security-and-operations.md). The controls
verified by tests include refresh rotation and reuse revocation, CSRF trusted
origins, CORS allowlisting, layered rate limits, CSP/HSTS headers, production
secret validation, KYC fail-closed gating, officer self-review prevention,
AES-256-GCM document encryption, HMAC webhook verification, and database-level
ledger immutability and balance enforcement.

Open findings (none are regressions introduced by this audit):

| Severity | Finding |
|---|---|
| High (operational) | No monitoring, alerting, or on-call |
| High (operational) | No penetration test or external review |
| Medium | Rate limits are per-process; restart clears them and replicas do not share a budget |
| Medium | `STORAGE_ENCRYPTION_KEY` has no re-key tooling |
| Medium | `INTERNAL_SERVICE_KEY` has no dual-key rotation window |
| Medium | Provider behavior unverified against real sandboxes |
| Medium | No browser end-to-end tests |
| Low | Profile IDs not unified with auth `sub` |
| Low | Pre-existing Prettier debt (209 files across four packages) |
| Low | CI format and audit steps cannot fail |

---

## 17. Blockers by environment

**Development — ready.** Full suite, lint, build, and local smoke pass; providers
are mocked by design; Chapa is intentionally disabled.

**Staging — not ready.** Requires: a real provider sandbox run for all three
providers, a deployed stack built from the current tree, `/ready` verification,
a browser end-to-end pass, and monitoring wired to the staging environment.

**Production — not ready.** Everything above, plus: penetration test, compliance
review, distributed rate limiting, secret-rotation drills, encrypted off-site
backups with a timed restore, on-call and alerting, capacity/load testing, a
payout provider for withdrawals, and an approved release record.

---

## 18. Prioritized next actions

1. **Review and commit** the working tree in coherent commits (security, KYC,
   ledger/payments, tests, docs). Do not push until the review is approved.
2. **Run CI remotely** on a branch/PR and fix whatever the first real run
   reveals.
3. **Prove the providers in sandbox**: one Brevo email, one Chapa Test Mode
   deposit with webhook replay and bad-signature rejection, one Didit session
   with webhook and decision mapping.
4. **Rebuild and deploy** to staging from the current tree; confirm `/ready`,
   `/health`, and Nginx routing.
5. **Add monitoring and alerting** (readiness, 5xx, login throttles, webhook
   signature failures, reconciliation mismatches).
6. **Add browser end-to-end tests** for register → verify → KYC → wallet →
   transfer → deposit.
7. **Commission a penetration test** and remediate findings.
8. **Decide on formatting**: either run `prettier --write` once and enforce it,
   or relax the check. Do not leave a permanently red non-blocking check.
9. **Implement withdrawals payout** with a real provider and sandbox proof.
10. **Exercise secret rotation** for JWT and `INTERNAL_SERVICE_KEY` in staging.

---

## 19. Release classification

| Environment | Classification | Basis |
|---|---|---|
| Development | **READY** | 221 tests, lint, build, OpenAPI, audit, ledger, local smoke |
| Staging | **NOT READY** | No deployed build, no real provider run, no monitoring |
| Production | **NOT READY** | No security review, HA, DR proof, on-call, or payout provider |

This is a truthful snapshot as of 2026-10-29. It should be updated, not
assumed, after each blocker above is actually closed.
