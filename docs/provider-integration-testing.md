# Provider Integration Testing

This document describes the three external providers (Brevo email, Chapa
payments, Didit identity verification), how each is configured, what is covered
by automated tests, what was **actually executed** during the final audit, and
the exact steps still required to prove each provider works against its real
sandbox.

**Ground rule:** no real-money transaction, no production customer data, and no
production provider was used. Chapa is restricted to Test Mode by code.

---

## 1. Status summary

| Provider | Purpose | Configured locally | Automated tests | Live/sandbox call executed | Verified end-to-end |
|---|---|---|---|---|---|
| Brevo | Email verification and password-reset OTPs | Yes (key present) | Yes (transport mocked) | **No** | **No** |
| Chapa | Wallet deposits (Test Mode only) | **No** (all vars empty) | Yes (fetch injected) | **No** | **No** |
| Didit | KYC sessions and webhook decisions | Yes (key, workflow, webhook secret present) | Yes (fetch stubbed, signatures computed) | **No** | **No** |

"Configured locally" means the variables are present in the untracked `.env`
files and pass startup validation. It does **not** mean a provider call
succeeded. No credential values are reproduced here or in any artifact.

---

## 2. Brevo (transactional email)

### Configuration

| Variable | Required | Format / notes |
|---|---|---|
| `BREVO_API_KEY` | Yes in production | REST `xkeysib-...` or SMTP `xsmtpsib-...` |
| `EMAIL_TRANSPORT` | Optional | `api` or `smtp`; inferred from key prefix when unset |
| `EMAIL_FROM` | Yes | Display name |
| `EMAIL_FROM_EMAIL` | Yes | Verified sender address in Brevo |
| `EMAIL_SMTP_HOST` | SMTP only | Defaults are not applied; must be set for SMTP |
| `EMAIL_SMTP_PORT` | SMTP only | Port 465 selects implicit TLS |
| `EMAIL_SMTP_USER` | SMTP only | Brevo SMTP login |

Startup fails in production if the key is missing, if its prefix does not match
a known Brevo key type, or if `EMAIL_TRANSPORT` contradicts the key prefix. This
was added during this audit: previously the service started with no email
capability and verification/reset silently could not be delivered.

### Behavior

- `api` transport POSTs to `https://api.brevo.com/v3/smtp/email` with the
  `api-key` header.
- `smtp` transport uses Nodemailer with a 10 s connection timeout.
- Delivery failure propagates as an error; the OTP is still stored so a resend
  is possible.
- The recipient address is logged; the OTP and key are not.

### Automated coverage

`backend/auth-service/tests/emailVerification.test.js` replaces the email
module with a controllable stub and exercises success, failure, and
"not configured" paths through the real auth service. It verifies that a
failed send does not consume the OTP and that resend works. It does **not** make
a network call to Brevo.

### What was executed

- Startup validation with a well-formed key: passes (all auth tests).
- Startup validation with a missing/malformed key: fails as intended (new test
  in `productionConfig.test.js`).
- **No email was sent.** An attempt to call the Brevo API directly to confirm
  the stored key was blocked by the execution environment's command policy.
  The key's presence is confirmed; its validity and deliverability are **not**.

### Remaining steps to verify real delivery

1. Confirm the sender address/domain is verified in the Brevo account.
2. Send one test message to a controlled mailbox using the deployment's
   `BREVO_API_KEY` (or the SMTP credentials) — a single low-volume request.
3. Register a throwaway account against a running stack and confirm the
   verification email arrives and the OTP is accepted.
4. Trigger a password reset and confirm that email arrives.
5. Record the result (date, transport, success/failure) in the release record.
   Do not paste the key or the OTP into the record.

Until steps 1–4 are done, treat email delivery as **unverified**.

---

## 3. Chapa (payments, Test Mode only)

### Configuration

| Variable | Required | Format / notes |
|---|---|---|
| `CHAPA_SECRET_KEY` | To enable deposits | Must start with `CHAPA_TEST_`; live keys are rejected |
| `CHAPA_WEBHOOK_SECRET` | With the key | At least 16 characters |
| `CHAPA_CALLBACK_URL` | With the key | HTTPS in production |
| `CHAPA_RETURN_URL` | With the key | HTTPS in production |
| `CHAPA_BASE_URL` | Optional | Pinned to `https://api.chapa.global` |

If `CHAPA_SECRET_KEY` is unset, deposits are disabled and payment endpoints
return `PAYMENT_PROVIDER_NOT_CONFIGURED`; the rest of the wallet works.
Partial configuration fails startup. A non-`CHAPA_TEST_` key fails startup.

### Behavior

- Hosted checkout at `POST https://api.chapa.global/v2/payments/hosted`.
- Amounts are converted to integer minor units (cents); merchant reference is
  sent as `merchant_reference` and as the `Idempotency-Key`.
- Webhooks require a valid HMAC-SHA256 signature over the raw body, compared
  with `timingSafeEqual`.
- A payment cannot become `COMPLETED` without a ledger entry (database trigger).
- Reconciliation records attempts and outcomes for stale payments.
- Deposits post to the ledger via the provider clearing account.

### Automated coverage

- `backend/user-service/tests/chapa.adapter.test.js` injects `fetchImpl` and
  asserts the exact URL, auth header, idempotency key, minor-unit conversion,
  and verification mapping. No network call.
- `backend/user-service/tests/payments.test.js` computes real HMAC signatures
  and covers webhook verification, replay/duplicate handling, and ledger
  effects.

### What was executed

- All Chapa tests pass with an injected fetch.
- Startup validation rejects live-format keys and partial configuration
  (unit tests).
- **No request was sent to Chapa.** All Chapa variables are empty in the local
  `.env`, so deposits are disabled in the running stack. No sandbox account was
  used.

### Remaining steps to verify real sandbox behavior

1. Obtain Chapa Test Mode credentials and a test webhook secret.
2. Set `CHAPA_SECRET_KEY=CHAPA_TEST_...`, `CHAPA_WEBHOOK_SECRET`,
   `CHAPA_CALLBACK_URL`, `CHAPA_RETURN_URL`; leave `CHAPA_BASE_URL` at the
   pinned default.
3. Start the user-service and create one deposit for the minimum amount with a
   test account.
4. Complete the hosted checkout in Test Mode; confirm the return URL, webhook
   delivery, signature acceptance, payment `COMPLETED`, and the matching ledger
   journal entry.
5. Deliver the same webhook twice; confirm the second is idempotent.
6. Send a webhook with a corrupted signature; confirm rejection.
7. Run reconciliation against a stale pending payment.
8. Record results. Do not enable live keys; the code rejects them.

---

## 4. Didit (KYC)

### Configuration

| Variable | Required | Format / notes |
|---|---|---|
| `DIDIT_API_KEY` | To enable KYC sessions | Provider-issued |
| `DIDIT_WORKFLOW_ID` | With the key | Provider workflow identifier |
| `DIDIT_WEBHOOK_SECRET` | With the key | HMAC secret |
| `DIDIT_WEBHOOK_SECRET_PREVIOUS` | Optional | Dual-secret window during rotation |
| `DIDIT_API_BASE_URL` | Optional | Pinned to `https://verification.didit.me` |
| `STORAGE_ENCRYPTION_KEY` | Yes in production | 64 hex chars; encrypts documents |

### Behavior

- Provider origin is pinned at startup; any other origin fails.
- Webhook signatures are HMAC-SHA256 over the raw body and compared
  timing-safely; a previous secret can be accepted during rotation.
- Provider statuses map to internal states explicitly; unknown statuses do not
  approve a user.
- Documents are stored with AES-256-GCM.
- Officer decisions are separate from provider status; self-review is blocked.
- Wallet creation and money movement fail closed if KYC status cannot be
  confirmed.

### Automated coverage

- `backend/kyc-service/tests/verification.test.js` stubs `global.fetch` for
  session creation and computes real webhook signatures. It covers accepted,
  rejected, corrupted, and dual-secret signatures and status mapping.
- `backend/kyc-service/tests/documents.test.js` covers encryption and access
  control.
- `backend/user-service/tests/kycService.integration.test.js` starts a **real**
  KYC-service process against a real database and exercises the internal status
  contract, wallet gating, and the officer decision — no provider network calls.

### What was executed

- All KYC tests pass, including the live cross-service suite (113 user-service
  tests, 0 skipped, with `KYC_TEST_DATABASE_URL`).
- Startup validation rejects a non-pinned origin and a malformed storage key.
- Credentials (API key, workflow, webhook secret) are present in the untracked
  KYC `.env` and pass validation.
- **No Didit session was created and no webhook was received.** No real identity
  data was submitted.

### Remaining steps to verify real sandbox behavior

1. Confirm the Didit workflow is in sandbox/test mode.
2. Create one session for a synthetic test identity through the KYC API.
3. Complete the provider flow in the sandbox and confirm the webhook is
   delivered to the deployment and accepted.
4. Confirm the stored decision maps to the expected internal state and that
   wallet creation is then permitted.
5. Replay and corrupt a webhook; confirm rejection.
6. Rotate the webhook secret using `DIDIT_WEBHOOK_SECRET_PREVIOUS` and confirm
   both secrets work during the window.
7. Record results. Use synthetic data only.

---

## 5. Mocked vs real boundary

| Layer | Tested with | Real external call |
|---|---|---|
| Auth flows, OTP lifecycle | Stubbed email module | No |
| Brevo REST/SMTP transport | Not unit-tested directly | No |
| Chapa adapter request/response | Injected `fetchImpl` | No |
| Chapa webhook signature and ledger | Real HMAC, real DB | No |
| Didit session creation | Stubbed `global.fetch` | No |
| Didit webhook signature and mapping | Real HMAC, real DB | No |
| Cross-service KYC gate | Real KYC process + DB | No provider |

The mocked boundary is deliberate: provider sandboxes require credentials and
network access that were not available, and no test should depend on an
external service to be reliable. The gap is that protocol drift (a provider
changing a field name or endpoint) would only surface in a real sandbox run.

## 6. Commands

```bash
# Provider-related suites
cd backend/auth-service   && npm test
cd backend/user-service   && npm test          # includes Chapa + cross-service KYC
cd backend/kyc-service    && npm test

# Cross-service KYC suite against an isolated database
cd backend/user-service
KYC_TEST_DATABASE_URL='postgresql://auth:auth@localhost:5432/kyc_test?schema=public' npm test
```

## 7. Credential handling rules

- Never print, log, commit, or paste provider keys into reports or tickets.
- Never place real keys in `.env.example` or `.env.production.example`.
- Use `CHAPA_TEST_` keys only; the application rejects anything else.
- Use synthetic identities for Didit sandbox runs.
- If a key is exposed, rotate it at the provider before continuing.
