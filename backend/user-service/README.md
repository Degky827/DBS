# User Service

Independent Express service for **profile management** and **authenticated wallet transfers**.

> **Authentication modes.** `AUTH_MODE=jwt` verifies access tokens from `auth-service` and is required in production. `AUTH_MODE=dev` uses opaque development sessions for standalone work and is rejected when `NODE_ENV=production`. Profile IDs are still separate from the auth-service user ID (`sub`); see [docs/INTEGRATION.md](docs/INTEGRATION.md).

## Service Overview

The User Service manages user profile information for the Digital Banking and Identity Verification Platform. It operates independently from `auth-service` with its own dedicated database (`user_db`).

**Responsibilities:**
- View authenticated user profiles
- Update profile fields and optionally upload a profile photo
- Change passwords (standalone development workflow)
- Create and retrieve one ETB wallet per profile
- Transfer wallet funds atomically and retrieve authorized transfer history

**Separations:**
- Does NOT own authentication tokens or sessions; it verifies auth-service access tokens in `AUTH_MODE=jwt`
- Does NOT share a database with `auth-service`

## Technology Stack

- Node.js (CommonJS), Express 5
- PostgreSQL + Prisma 7 (`@prisma/adapter-pg`)
- Zod validation, bcryptjs
- Swagger UI, pino, helmet, express-rate-limit
- Tests: Node.js built-in test runner + supertest

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | >= 18.x |
| PostgreSQL | >= 14 |
| npm | >= 9 |
| Docker (optional) | For local Postgres via the dev Compose stack |

## Port & Database

| Item | Value |
|---|---|
| Port | `5002` |
| Database | **`user_db`** (dedicated; do not use `auth_db`) |
| Schema | `public` |
| API prefix | `/api/v1` |

## Setup

### 1. Create the development database

Using the development Compose Postgres (adjust the container and user if customized):

```bash
docker compose -f docker-compose.dev.yml up -d postgres
docker exec -it meridian-dev-postgres-1 psql -U meridian -d postgres -c "CREATE DATABASE user_db;"
```

Or with a local `psql`:

```bash
createdb -U meridian user_db
```

Do **not** run this against `auth_db`.

### 2. Configure environment

```bash
cd backend/user-service
cp .env.example .env
# edit DATABASE_URL if needed
```

Key variables (see `.env.example` for placeholders):

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `5002` | |
| `DATABASE_URL` | `postgresql://DB_USER:DB_PASSWORD@localhost:5432/user_db?schema=public` | Dedicated DB |
| `AUTH_MODE` | `dev` (schema default) | Use `jwt` when auth-service is available; `dev` is rejected in production |
| `DEV_SESSION_TTL_MS` | `28800000` (8h) | Dev session lifetime |
| `DEV_API_KEY` | empty | If set, require header `X-Dev-Api-Key` |
| `BCRYPT_ROUNDS` | `12` | |
| `ENABLE_API_DOCS` | `true` | Swagger at `/api/v1/docs` |
| `CHAPA_SECRET_KEY` | empty | Optional; must be a Chapa `CHAPA_TEST_...` private key |
| `CHAPA_WEBHOOK_SECRET` | empty | Required with the test key; HMAC secret configured for Chapa webhooks |
| `CHAPA_BASE_URL` | `https://api.chapa.global` | Chapa API v2 host; the service rejects other hosts |
| `CHAPA_CALLBACK_URL` | empty | Required to enable test deposits; public HTTPS webhook URL |
| `CHAPA_RETURN_URL` | empty | Required with the test key; frontend return page verifies status through the API |

### 3. Install, migrate, seed

```bash
npm install
npx prisma generate
npx prisma migrate deploy
npm run db:seed
```

### 4. Run

```bash
npm run dev      # nodemon
# or
npm start
```

Service root: `http://localhost:5002/`  
Health: `http://localhost:5002/api/v1/health`  
Swagger: `http://localhost:5002/api/v1/docs`  
OpenAPI JSON: `http://localhost:5002/api/v1/openapi.json`

## Seeded development users

| Email | Username | Password |
|---|---|---|
| `demo.user@user.local` | `demo_user` | `DemoPass@1234` |
| `profile.editor@user.local` | `profile_editor` | `ProfilePass@1234` |

These users exist **only** in `user_db`. They are not copied from auth-service.

## API Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/v1/health` | None | Liveness probe |
| POST | `/api/v1/auth/dev-login` | email + password | Create dev session token |
| POST | `/api/v1/auth/dev-logout` | Bearer | Revoke current session |
| GET | `/api/v1/users/me` | Bearer | View profile |
| PATCH | `/api/v1/users/me` | Bearer | Update profile fields and optionally upload a profile photo |
| PATCH | `/api/v1/users/me/password` | Bearer | Change password |

The authoritative machine-readable contract is the OpenAPI specification at `GET /api/v1/openapi.json`.

Wallet and transaction endpoints:

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/wallets` | Create the authenticated user's zero-balance ETB wallet |
| GET | `/api/v1/wallets/me` | Retrieve the authenticated user's wallet and balance |
| GET | `/api/v1/wallets/:walletId` | Retrieve a wallet only when owned by the authenticated user |
| POST | `/api/v1/transactions/transfers` | Transfer funds between same-currency wallets |
| GET | `/api/v1/transactions` | Retrieve up to 100 recent transfers involving the user's wallet |
| GET | `/api/v1/transactions/:reference` | Retrieve a transaction visible to the authenticated user |

Transfers require a positive decimal **string** with at most two fractional digits and a unique `Idempotency-Key` header. Reusing the key with the same request returns the original transaction; reusing it for different details returns `409`. Transfers lock both wallet rows in a deterministic order, run at serializable isolation, and update balances and the transaction record in one database transaction.

Wallets start at `0.00 ETB` and active; each profile can create one wallet. Transfers reject inactive source or destination wallets. There is not yet a customer or admin API to change wallet activity.

Transaction history supports cursor pagination (`limit` 1–100, default 25), `direction=all|incoming|outgoing`, and inclusive ISO 8601 `from`/`to` timestamp filters. The next page uses the returned `page.nextCursor`; cursors are checked against the authenticated wallet and active filters.

Internal transfers and transaction history continue to work independently from payments. ETB is the only supported wallet currency.

Chapa Hosted Checkout is implemented in **Test Mode only**. Deposits are disabled unless all of `CHAPA_SECRET_KEY` (must begin `CHAPA_TEST_`), `CHAPA_WEBHOOK_SECRET`, `CHAPA_CALLBACK_URL`, and `CHAPA_RETURN_URL` are configured. The adapter uses the documented Chapa v2 hosted checkout and verification APIs, sends ETB amounts as integer cents, and uses the internal merchant reference as Chapa's idempotency key. A browser return only triggers authenticated server-side verification; it never confirms payment by itself. A signed webhook triggers the same verification, which must match the merchant reference, ETB currency, and exact amount before a single wallet credit and linked `DEPOSIT` ledger transaction are atomically committed. Raw webhook bytes are authenticated using Chapa's documented lowercase-hex HMAC-SHA256 `x-chapa-signature`.

Use only a Chapa Test Mode private key. Live keys and arbitrary API hosts are rejected by configuration validation. Do not use real money in these flows. Chapa's current API host is `https://api.chapa.global`; test/live selection is determined by the key. Chapa must be able to reach the configured callback URL, which must be HTTPS outside local development. Do not enable deposits until webhook delivery and a complete signed test checkout are verified in the Chapa merchant dashboard.

`POST /api/v1/payments/deposits` requires authentication and an `Idempotency-Key`; it accepts positive ETB decimal strings of at least `1.00`. Reusing a key with identical parameters returns the same payment; changing the amount returns `409`. `GET /api/v1/payments/deposits/{reference}/verify` requires the payment owner and checks the provider directly. `POST /api/v1/payments/webhook` is unauthenticated but rejects unsigned/invalid raw-body signatures and processes payment events only after server-side verification. Duplicate delivery hashes are stored and repeated processing cannot double-credit. Pending verification remains pending; stale pending events cannot revert a completed or failed state, while a later successful authoritative verification can complete a formerly failed payment. Amount, currency, or merchant-reference mismatches never credit funds.

Withdrawals use an internal reservation lifecycle only. `POST /api/v1/payments/withdrawals` debits the wallet and credits `PLATFORM:WITHDRAWAL_RESERVED`; `GET /api/v1/payments/withdrawals/{reference}` returns the owner's request; `POST /api/v1/payments/withdrawals/{reference}/cancel` posts the compensating entry. No payout provider is integrated, so there is no `COMPLETED` withdrawal state and no external transfer is fabricated. Withdrawals with a configured fee are rejected until payout accounting exists. Provider refunds remain unsupported (`501`).

### Phase 3 ledger, reversals, policies, and reconciliation

Every wallet movement is posted through a double-entry ledger. Wallet balances are customer liabilities, not platform revenue; deposits debit `PLATFORM:PROVIDER_CLEARING` and credit the wallet liability, and fees (when configured) credit `PLATFORM:FEE_REVENUE`. Posted entries are immutable and must balance per currency. `Wallet.balance` is a database-checked projection of its ledger account. See [docs/phase3-ledger.md](docs/phase3-ledger.md) for the account model, journal examples, lifecycle states, and guarantees.

Administrators can reverse internal transfers with `POST /api/v1/transactions/{reference}/reversals` (full or partial, reason required, idempotent). Pre-ledger transactions are marked `LEGACY` and cannot be reversed through the ledger. Transaction responses now include `status`, `currency`, `feeAmount`, `reversedAmount`, and `ledgerEntryReference`.

Financial limits and fees are stored in `FinancialPolicy`, enforced server-side, and changed only by ADMINs through `GET/PATCH /api/v1/admin/financial-policies` with an audited reason. Business dates use the policy timezone. Stale pending deposits are re-verified by `POST /api/v1/admin/payments/reconciliation` or by the optional in-process scheduler (`RECONCILIATION_ENABLED`). A provider timeout is never treated as failure and mismatches are recorded for manual review without crediting funds.

`npm run ledger:verify` runs read-only checks for entry balance, account/wallet projection, transaction/reversal/withdrawal consistency, payment completion, and legacy provenance.


### Phase 4 migration and test setup

The additive `20261027100000_wallet_transactions` migration creates the ETB wallet and internal transfer tables. The `20261027110000_payments_chapa` migration adds payment records, transaction-to-payment linkage for deposits, and deduplicated webhook-delivery records. The `20261028120000_double_entry_ledger` migration adds the ledger, policy, withdrawal, and reconciliation tables, marks pre-ledger transactions `LEGACY`, and snapshots positive wallet balances into balanced opening entries. Apply migrations only after backing up and verifying on a disposable copy; see [docs/phase3-ledger.md](docs/phase3-ledger.md) for the procedure and rollback limits:

```bash
npx prisma generate
npx prisma migrate deploy
```

Wallet integration tests require a separate PostgreSQL database whose name ends in `_test`. Set `WALLET_TEST_DATABASE_URL` only in the test process (for example, `postgresql://auth:auth@localhost:5432/user_service_test?schema=public`), apply migrations to it with `npx prisma migrate deploy`, and run `npm run test:wallets`. The test file refuses database names without the `_test` suffix. The existing user-service regression suite runs with `npm test`.

Payment integration tests use `WALLET_TEST_DATABASE_URL` and refuse database names without the `_test` suffix. After deploying migrations to that isolated database, run `npm run test:payments`. `npm run test:payments-adapter` runs mocked Chapa v2 request and webhook-signature tests without database or network access.

Phase 3 suites (`test:ledger`, `test:policies`) also require the isolated `_test` database. Run them sequentially because they share policy and wallet state:

```bash
WALLET_TEST_DATABASE_URL='postgresql://auth:auth@localhost:5432/user_phase3_test?schema=public' npm run test:phase3
DATABASE_URL='postgresql://auth:auth@localhost:5432/user_phase3_test?schema=public' npm run ledger:verify
```

### Permitted profile update fields

`firstName`, `middleName`, `lastName`, `phoneNumber`, `gender`, `dateOfBirth`,  
`addressLine1`, `addressLine2`, `city`, `state`, `postalCode`, `country`, `bio`, `avatarUrl`

**Not allowed:** `email`, `username`, `role`, `passwordHash`

### Change password rules

- `currentPassword` must match the stored hash (wrong value → `401`, no DB write)
- `newPassword` must be **8–72 characters** (no character-class composition rules)
- `newPassword` must differ from `currentPassword`
- `confirmNewPassword` must match `newPassword`
- On success, other development sessions for the user are revoked
- Passwords are never logged or returned in responses

### Update profile rules

- Identity comes only from the server-side session (`req.user.id`)
- At least one permitted field is required (empty body → `400`)
- Unexpected/protected fields (`email`, `username`, `role`, `id`, `passwordHash`, …) are rejected (`400`), not ignored
- `dateOfBirth` must be a real past date; `middleName: ""` clears the value
- `avatar` may be uploaded as multipart form data (PNG, JPEG, or WebP; maximum 5 MB)
- A permitted body with unchanged values still returns `200` with the profile
- Missing user → `404`

Uploaded avatars are saved under `AVATAR_UPLOAD_DIR` and served from
`/uploads/avatars/`. Docker Compose mounts this directory to a persistent volume.

## Example session

```bash
# Login (dev)
curl -s -X POST http://localhost:5002/api/v1/auth/dev-login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo.user@user.local","password":"DemoPass@1234"}'

# Use token from data.token
TOKEN=...

curl -s http://localhost:5002/api/v1/users/me -H "Authorization: Bearer $TOKEN"

curl -s -X PATCH http://localhost:5002/api/v1/users/me \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"city":"Dire Dawa","bio":"Updated bio"}'

# Upload a profile photo (can be combined with profile fields in the same request)
curl -s -X PATCH http://localhost:5002/api/v1/users/me \
  -H "Authorization: Bearer $TOKEN" \
  -F "avatar=@profile.png"

curl -s -X PATCH http://localhost:5002/api/v1/users/me/password \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"DemoPass@1234","newPassword":"BrandNewPass@123","confirmNewPassword":"BrandNewPass@123"}'
```

## Tests

```bash
npm test
```

Tests use an isolated in-process app instance. Ensure `DATABASE_URL` points at `user_db` (not `auth_db`) before running.

The wallet integration suite must use a separate database whose name ends in `_test`. Set `WALLET_TEST_DATABASE_URL` to that database's connection string, deploy migrations to it, then run `npm run test:wallets`; the suite refuses to run without this explicit test-database URL.

### Previously reported results

| Suite | Tests | Result | Date |
|---|---|---|---|
| Automated regression (`npm test`) | 24 | 24 passed | 2026-10-15 (Step 9) |
| Live HTTP integration (E2E) | 64 | 64 passed | 2026-10-15 (Step 9) |

These are previously reported results from Step 9. They were not re-executed during Step 10.

## Response envelope

Success:

```json
{ "success": true, "message": "Profile fetched", "data": { } }
```

Error:

```json
{ "success": false, "message": "Validation failed", "errors": { "city": "..." } }
```

## Boundaries

- Does **not** modify auth-service, its database, or docker-compose.
- Does **not** integrate with auth-service JWT yet.
- Production startup with `AUTH_MODE=dev` is blocked by design.
