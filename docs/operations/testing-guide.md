# Testing Guide
## Meridian Digital Banking Platform

**Version:** 2.0  
**Last Updated:** 2026-11-02

---

## Table of Contents
1. [Testing Philosophy](#testing-philosophy)
2. [Test Infrastructure](#test-infrastructure)
3. [Running Tests](#running-tests)
4. [Test Coverage](#test-coverage)
5. [Writing Tests](#writing-tests)
6. [CI/CD Integration](#cicd-integration)
7. [Manual Testing](#manual-testing)

---

## Testing Philosophy

### Test Pyramid

```
         /\
        /  \  End-to-End Tests
       /____\  (Playwright, Cypress)
      /      \
     / Integr-\  Integration Tests
    / ation   \  (with real PostgreSQL)
   /__________\
  /            \
 /    Unit      \  Unit Tests
/    Tests       \  (Node.js test runner)
/________________\
```

### Priorities

1. **Financial Integrity**: Every transaction test must verify balance consistency
2. **Security**: Authentication, authorization, token validation, rate limiting
3. **Data Integrity**: Database constraints, migrations, backups
4. **User Experience**: Error messages, loading states, accessibility
5. **Performance**: Response times, concurrent operations, rate limits

### What We Test

- ✓ Business logic and validation rules
- ✓ Database operations and transactions
- ✓ Authentication and authorization flows
- ✓ API endpoints and error handling
- ✓ Financial operations and concurrency
- ✓ Security boundaries and rate limits
- ✓ Migration forward compatibility
- ✓ Domain events written in the same transaction as the change that caused them

### What We Don't Test

- ✗ Third-party library internals
- ✗ Node.js/Express.js framework behavior
- ✗ PostgreSQL transaction guarantees
- ✗ Docker networking

---

## Test Infrastructure

### Backend Test Databases

Tests require isolated PostgreSQL databases. The repeatable path is a single
script, which creates the four databases if missing and applies each service's
migrations:

```bash
# Development PostgreSQL (via Docker)
docker compose -f docker-compose.dev.yml up -d postgres

# Create auth_test, user_test, kyc_test, notification_test and migrate them
./scripts/create-test-databases.sh
```

The script targets the local Compose project (`COMPOSE_PROJECT_NAME`, default
`banking-system`) and the `postgres` service; override `COMPOSE_FILE`,
`POSTGRES_USER` or `POSTGRES_PASSWORD` if the dev stack uses different values.
It refuses to run anywhere that is not the Compose-internal PostgreSQL host.

The equivalent manual commands are:

```bash
# Development PostgreSQL (via Docker)
docker compose -f docker-compose.dev.yml up -d postgres

# Create test databases
docker compose -f docker-compose.dev.yml exec -T postgres psql -U meridian -d postgres <<EOF
CREATE DATABASE auth_test;
CREATE DATABASE user_test;
CREATE DATABASE kyc_test;
CREATE DATABASE notification_test;
EOF

# Migrate each test database before running the suites that use it
(cd backend/user-service && DATABASE_URL='postgresql://meridian:dev-only-postgres-password@localhost:5432/user_test?schema=public' npx prisma migrate deploy)
(cd backend/kyc-service && DATABASE_URL='postgresql://meridian:dev-only-postgres-password@localhost:5432/kyc_test?schema=public' npx prisma migrate deploy)
(cd backend/notification-service && DATABASE_URL='postgresql://meridian:dev-only-postgres-password@localhost:5432/notification_test?schema=public' npx prisma migrate deploy)
```

Migrations are not applied automatically by the test scripts. A test database that
is behind the schema fails with a Prisma `P2022` (missing column or table) rather
than a logic error, so re-run `prisma migrate deploy` after every migration commit.

### Environment Variables for Testing

```bash
# Auth Service Tests
export DATABASE_URL="postgresql://meridian:password@localhost:5432/auth_test?schema=public"
export JWT_SECRET="test-jwt-secret-0123456789abcdef0123456789abcdef"
export INTERNAL_SERVICE_KEY="test-internal-key-0123456789abcdef"
export NODE_ENV="test"

# User Service Tests (Integration)
export WALLET_TEST_DATABASE_URL="postgresql://meridian:password@localhost:5432/user_test?schema=public"
# Enables the cross-service KYC integration tests; without them the suite
# reports them as skipped with an explicit reason.
export KYC_TEST_DATABASE_URL="postgresql://meridian:password@localhost:5432/kyc_test?schema=public"

# KYC Service Tests
export STORAGE_ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

# Notification Service Tests
# Optional: the suite falls back to postgresql://auth:auth@localhost:5432/notification_test
export NOTIFICATION_TEST_DATABASE_URL="postgresql://meridian:password@localhost:5432/notification_test?schema=public"
```

The outbox and scheduled-transfer suites set `OUTBOX_ENABLED=true` themselves, so
event rows are written even when the dispatcher is not running. No test starts the
dispatcher or the scheduled-transfer worker; both are exercised by calling
`executeDueSchedules()` and the outbox service directly.

### Test Database Safety

Every user-service integration suite refuses to run unless its database is named with a
`_test` suffix:

```javascript
const testDatabaseName = new URL(testDatabaseUrl).pathname.split("/").pop().split("?")[0];
if (!/_test$/i.test(testDatabaseName)) {
  throw new Error("Tests only run against a database whose name ends in _test");
}
```

This prevents accidentally running destructive tests against production or development
databases. The notification-service suites default to `notification_test` but do not
enforce the suffix, so point `NOTIFICATION_TEST_DATABASE_URL` at a throw-away database
yourself when you override it.

---

## Running Tests

### Backend Unit Tests

#### Auth Service

```bash
cd backend/auth-service

# Run all tests
npm test

# Run specific test file
node --test tests/security.test.js
node --test tests/passwordReset.test.js
node --test tests/emailVerification.test.js

# Run with verbose output
node --test --test-reporter=spec tests/security.test.js
```

#### User Service

```bash
cd backend/user-service

# Default suite (profile, wallet and payment flows, mocked KYC)
npm test

# Integration suites (require WALLET_TEST_DATABASE_URL)
npm run test:wallets
npm run test:financial-integrity
npm run test:payments
npm run test:payments-adapter     # Chapa adapter, no network access
npm run test:ledger
npm run test:policies
npm run test:admin
npm run test:beneficiaries
npm run test:statements
npm run test:kyc                  # KYC eligibility rules

# Suites that drive the phase-3 background paths directly
npm run test:scheduled-transfers  # requires WALLET_TEST_DATABASE_URL
npm run test:disputes             # requires WALLET_TEST_DATABASE_URL
npm run test:integration          # requires KYC_TEST_DATABASE_URL (starts kyc-service)

# Phase 4: ledger verification engine (checks, run history, issue workflow)
npm run test:ledger-verification  # requires WALLET_TEST_DATABASE_URL
npm run ledger:verify -- --json   # read-only integrity scan, no rows written
npm run ledger:verify -- --record --trigger CI

# Everything (runs files sequentially against one test database)
npm run test:all
```

`scheduledTransfers.test.js` and `disputes.test.js` post ledger funding entries and
transfer rows into the same test database as the other suites, so they must not run
concurrently against it (`test:all` uses `--test-concurrency=1`).

`ledgerVerification.test.js` behaves the same way and needs the same guard. It
funds wallets through the ledger, then deliberately injects inconsistent rows
(an orphan transfer, a settlement-less payout, a withdrawal without a
reservation) to prove a run reports `FAILED`, records the finding exactly once
and publishes one integrity alert through the outbox. Those fixtures are written
to `WALLET_TEST_DATABASE_URL` and deleted afterwards; verification runs from
earlier CI executions stay behind, which is why the suite asserts on relative
counts and on its own run reference rather than on absolute totals.

#### KYC Service

```bash
cd backend/kyc-service

# All tests
npm test

# OCR smoke test (downloads Tesseract data)
npm run test:ocr
```

#### Notification Service

```bash
cd backend/notification-service

# Runs against notification_test by default (auth:auth@localhost:5432).
# Override the target database with NOTIFICATION_TEST_DATABASE_URL.
NOTIFICATION_TEST_DATABASE_URL='postgresql://meridian:password@localhost:5432/notification_test?schema=public' npm test
```

The suite configures itself: `EMAIL_ENABLED=false`, a test JWT secret and a test internal
key are set inside the test files, so no `.env` is required. It covers the internal event
consumer (shared-secret authentication, duplicate event ids, per-recipient dedupe), inbox
pagination and read marking, preference filtering, and the email templates. No provider
call is made because email is disabled.

### Frontend Tests

```bash
cd frontend

# Run all tests
npm test

# Run with coverage (future enhancement)
# npm test -- --coverage
```

### Integration Tests (Full Stack)

```bash
# Start services
docker compose -f docker-compose.dev.yml up -d

# Wait for services to be healthy
sleep 30

# Run health checks against the running stack
for path in /api/auth/health /api/user/health /api/kyc/health /api/notifications/health; do
    curl -fsS "http://localhost:8080${path}" >/dev/null || { echo "FAILED ${path}" && exit 1; }
done

# Internal endpoints must not be reachable through the proxy
for path in /api/notifications/internal/notifications/events /api/user/internal/outbox/events; do
    code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://localhost:8080${path}")
    [ "$code" = "403" ] || { echo "EXPECTED 403 FOR ${path}, GOT ${code}" && exit 1; }
done

# End-to-end tests are not implemented yet
# cd frontend
# npm run test:e2e
```

### Running Tests in CI

Tests and gates run automatically via GitHub Actions on every push and pull request.
See `.github/workflows/ci.yml` (build and test) and `.github/workflows/codeql.yml`
(sast).

| Job | Blocks the run | What it does |
|---|---|---|
| `lint` | yes | ESLint in all five packages |
| `format-check` | yes | Prettier `--check` on JS/JSX/JSON/CSS files changed in the push or PR |
| `test-auth-service` | yes | auth-service suite against `auth_test` |
| `test-user-service` | yes | `npm run test:all` against `user_test`, plus a provisioned `kyc_test` so the cross-service tests cannot silently skip |
| `test-kyc-service` | yes | kyc-service suite against `kyc_test` |
| `test-notification-service` | yes | notification-service suite against `notification_test` |
| `test-frontend` | yes | frontend unit tests |
| `build-frontend` | yes | Vite production build |
| `build-docker-images`, `build-frontend-docker` | yes | Images for all five services (Buildx + layer cache) |
| `validate-openapi` | yes | Every published OpenAPI document parses and matches the route table |
| `security-audit` | yes | `npm audit` per package: production tree at `moderate`, full tree at `high` |
| `secrets-hygiene` | yes | Fails if a `.env`, key, certificate, `certs/`, `certbot/`, `backups/` or `monitoring/secrets/` file is tracked, or if added lines match a credential pattern |
| `dependency-review` | yes (PRs) | Reported severity `high` or above in new dependencies |
| `scan-docker-images` | yes | Trivy on each built image; fixable `CRITICAL`/`HIGH` vulnerabilities fail |
| `analyze (javascript-typescript)`, `analyze (actions)` | CRITICAL only | CodeQL `security-extended`; SARIF is uploaded and a step fails the job on any `security-severity >= 9` result |
| `all-checks-complete` | aggregate | Requires every job above to be `success` or `skipped` |

`security-audit` and `secrets-hygiene` are fail-closing: an unreachable registry or a
crashed scan fails the job instead of passing it.

```bash
# Simulate CI locally
# Install dependencies
cd backend/auth-service && npm ci && cd ../..
cd backend/user-service && npm ci && cd ../..
cd backend/kyc-service && npm ci && cd ../..
cd backend/notification-service && npm ci && cd ../..
cd frontend && npm ci && cd ..

# Run linting
cd frontend && npm run lint && cd ..
for service in auth-service user-service kyc-service notification-service; do
  (cd backend/$service && npm run lint)
done

# Run tests
cd backend/auth-service && npm test && cd ../..
cd backend/user-service && \
WALLET_TEST_DATABASE_URL='postgresql://meridian:password@localhost:5432/user_test?schema=public' \
KYC_TEST_DATABASE_URL='postgresql://meridian:password@localhost:5432/kyc_test?schema=public' \
  npm run test:all && cd ../..
cd backend/kyc-service && npm test && cd ../..
cd backend/notification-service && \
NOTIFICATION_TEST_DATABASE_URL='postgresql://meridian:password@localhost:5432/notification_test?schema=public' \
  npm test && cd ../..
cd frontend && npm test && cd ..

# Formatting gate (only the files you changed)
git diff --name-only --diff-filter=ACMR origin/dev HEAD -- '*.js' '*.jsx' '*.json' '*.css' \
  | grep -v package-lock.json | xargs -r ./frontend/node_modules/.bin/prettier --check
```

---

## Test Coverage

### Current Coverage (as of 2026-11-02)

335 automated tests run in CI across five suites: 75 auth, 174 user, 64 KYC, 11 notification, 11 frontend.

| Service | Test Files | Coverage | Key Areas |
|---------|-----------|----------|-----------|
| **Auth Service** | 9 | ★★★★☆ | Security, refresh tokens, OTP, MFA, password reset, rate limiting, metrics, production config |
| **User Service** | 17 | ★★★★★ | Wallets, transfers, concurrency, idempotency, financial integrity, ledger, policies, admin operations, account lifecycle, beneficiaries, scheduled transfers, statements, disputes, KYC eligibility |
| **KYC Service** | 11 | ★★★★☆ | Documents, submissions, OCR, approval lifecycle, verification workflow, webhook limits, secure storage, production config |
| **Notification Service** | 2 | ★★★☆☆ | Internal event consumer, dedupe, inbox, preferences, templates |
| **Frontend** | 2 | ★☆☆☆☆ | Redux auth slice, API error mapping |

### Critical Paths Tested

✅ **Authentication**
- Registration with email verification
- Login with password
- JWT access token validation
- Refresh token rotation and reuse detection
- Session revocation
- Rate limiting (login, registration, refresh)
- CORS and CSRF protection

✅ **Financial Operations**
- Wallet creation (one per user)
- Balance retrieval (owner only)
- Internal transfers
- Idempotency (duplicate request handling)
- Concurrency (parallel transfers)
- Balance atomicity (no negative balances)
- Monetary precision (exact decimal arithmetic)
- Transaction history
- Double-entry ledger balance and immutability
- Configurable fees and daily limits
- Deposit reconciliation and admin reversals
- Saved beneficiaries (masking, uniqueness, wallet ownership, favorite ordering)
- Scheduled transfers (planning, transitions, at-least-once execution, failure handling)
- Statements (opening/closing reconstruction, period validation, PDF export)
- Disputes (submission, ownership, staff workflow, terminal states)

✅ **KYC Workflow**
- Document upload with encryption
- Access control (owner + officer)
- OCR text extraction
- Submission lifecycle
- Provider integration
- Webhook security

✅ **Events and Notifications**
- Outbox rows commit with the business change
- Status changes, transfers, disputes and failed schedules each publish exactly one event
- Consumer rejects a missing or wrong internal key
- Duplicate and re-delivered event ids do not create a second notification
- Preferences suppress in-app rows and email
- Account freeze reaches auth-service and publishes `account.status_changed`

### Gaps (Future Enhancements)

❌ **Not Yet Tested**
- End-to-end user journeys
- Frontend component rendering
- Error boundaries
- Accessibility (WCAG)
- Load testing
- Chaos engineering
- External provider integration (Chapa, Didit)
- The outbox dispatcher and scheduled-transfer worker timers themselves (unit-tested through the service functions, not through the polling loop)
- PDF byte-for-byte layout (only structure and headers are asserted)

---

## Writing Tests

### Test Structure

Use Node.js native test runner:

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");

test("descriptive test name", async () => {
  // Arrange: Setup
  const user = await createTestUser();
  
  // Act: Execute the operation
  const result = await someOperation(user);
  
  // Assert: Verify expectations
  assert.equal(result.status, "success");
  assert.ok(result.data);
});

test("another test in same file", async () => {
  // ...
});
```

### Database Tests

Use `test.before` and `test.after` for setup/cleanup:

```javascript
const { before, after, test } = require("node:test");
const prisma = require("../src/config/database");

const testUsers = [];

before(async () => {
  await prisma.$connect();
  // Create fixtures
  const user = await prisma.user.create({...});
  testUsers.push(user);
});

after(async () => {
  // Cleanup
  await prisma.user.deleteMany({
    where: { id: { in: testUsers.map(u => u.id) } }
  });
  await prisma.$disconnect();
});

test("database operation", async () => {
  // Test using testUsers
});
```

### Financial Tests

Always verify balance consistency:

```javascript
test("transfer updates both balances correctly", async () => {
  const before = {
    sender: await getBalance(sender.id),
    recipient: await getBalance(recipient.id),
  };
  
  await transfer(sender.id, recipient.id, "10.00");
  
  const after = {
    sender: await getBalance(sender.id),
    recipient: await getBalance(recipient.id),
  };
  
  assert.equal(
    parseFloat(before.sender) - 10.0,
    parseFloat(after.sender)
  );
  assert.equal(
    parseFloat(before.recipient) + 10.0,
    parseFloat(after.recipient)
  );
  
  // Verify total money supply unchanged
  const beforeTotal = parseFloat(before.sender) + parseFloat(before.recipient);
  const afterTotal = parseFloat(after.sender) + parseFloat(after.recipient);
  assert.ok(Math.abs(beforeTotal - afterTotal) < 0.01);
});
```

### Security Tests

Test both positive and negative cases:

```javascript
test("authenticated endpoint rejects missing token", async () => {
  const response = await request(app)
    .get("/api/v1/protected")
    .send();
  
  assert.equal(response.status, 401);
  assert.equal(response.body.code, "TOKEN_MISSING");
});

test("authenticated endpoint accepts valid token", async () => {
  const token = await generateValidToken(user);
  
  const response = await request(app)
    .get("/api/v1/protected")
    .set("Authorization", `Bearer ${token}`)
    .send();
  
  assert.equal(response.status, 200);
});
```

### API Tests with Supertest

```javascript
const request = require("supertest");
const app = require("../src/app");

test("POST /api/v1/endpoint returns expected response", async () => {
  const response = await request(app)
    .post("/api/v1/endpoint")
    .set("Authorization", "Bearer token")
    .send({ field: "value" });
  
  assert.equal(response.status, 201);
  assert.equal(response.body.success, true);
  assert.ok(response.body.data);
});
```

### Mocking External Services

```javascript
// Mock KYC service
const kycEligibility = require("../src/services/kycEligibility");

before(() => {
  kycEligibility.setKycClient({
    async getUserKycStatus(userId) {
      return { status: "APPROVED", isApproved: true };
    },
  });
});

after(() => {
  kycEligibility.setKycClient(null);
});
```

### Testing Concurrency

```javascript
test("concurrent operations are handled safely", async () => {
  const operations = Array.from({ length: 10 }, () =>
    performOperation()
  );
  
  const results = await Promise.all(operations);
  
  // Verify results are consistent
  const succeeded = results.filter(r => r.status === 201).length;
  const failed = results.filter(r => r.status === 409).length;
  
  assert.ok(succeeded > 0, "At least one should succeed");
  assert.equal(succeeded + failed, 10, "All requests accounted for");
});
```

---

## CI/CD Integration

### GitHub Actions Workflow

See `.github/workflows/ci.yml` for the full CI pipeline and `.github/workflows/codeql.yml`
for SAST.

**Pipeline Stages:**

1. **Detect Base Revision** - resolves the diff range the format gate uses
2. **Lint** - ESLint across all five packages
3. **Format Changed Sources** - Prettier check limited to files touched by the change
4. **Test** - auth, user (all suites), KYC, notification, and frontend jobs
5. **Build Frontend** - production Vite build
6. **Build Docker Images** - all five service images plus the frontend image
7. **Validate OpenAPI** - every service's published specification
8. **Dependency Security Audit** - `npm audit`, fail-closing
9. **No Committed Secrets** - tracked-file and added-line credential scan
10. **Dependency Review** - new dependencies in pull requests
11. **Scan Docker Images** - Trivy against each built image
12. **CodeQL** - `security-extended` for JavaScript/TypeScript and Actions; only CRITICAL findings block
13. **All Checks Complete** - aggregate gate required by branch protection

### Running CI Locally

```bash
# Install Act (GitHub Actions local runner)
# https://github.com/nektos/act

# Run CI workflow locally
act pull_request

# Run specific job
act -j test-auth-service
act -j test-user-service
act -j test-notification-service
```

The jobs that need PostgreSQL declare a `postgres` service container; Act needs Docker
available. The `security-audit`, `secrets-hygiene`, `scan-docker-images` and CodeQL jobs
assume GitHub runner tooling (psql client, Buildx, Trivy, the CodeQL bundle) and are the
ones least faithful to a local run — use the "Simulate CI locally" commands above instead.

### Branch Protection

Configure branch protection for `main` and `dev`:

- ✓ Require pull request reviews
- ✓ Require status checks to pass:
  - `Lint Sources`
  - `Format Changed Sources`
  - `Test Auth Service`
  - `Test User Service`
  - `Test KYC Service`
  - `Test Notification Service`
  - `Test Frontend`
  - `Build Frontend`
  - `Build Docker Images`
  - `Build Frontend Docker Image`
  - `Validate OpenAPI Specs`
  - `Dependency Security Audit`
  - `No Committed Secrets`
  - `Scan Docker Images`
  - `Analyze (javascript-typescript)`
  - `Analyze (actions)`
  - `All Checks Complete`
- ✓ Require branches to be up to date
- ✓ No force pushes
- ✓ No deletion

`Dependency Review` only runs on pull requests, so it is not required as a push check.

---

## Manual Testing

### Local Development Testing

1. **Start Services**
```bash
docker compose -f docker-compose.dev.yml up --build
```

2. **Test API Endpoints**
```bash
# Health checks
curl http://localhost:5001/api/v1/health
curl http://localhost:5002/api/v1/health
curl http://localhost:5003/api/v1/kyc/health
curl http://localhost:5004/api/v1/health

# API Documentation
open http://localhost:5001/api/v1/docs
open http://localhost:5002/api/v1/docs
open http://localhost:5003/api/v1/kyc/docs
open http://localhost:5004/api/v1/docs

# Frontend
open http://localhost:5173
```

3. **Test User Flow**
- Register new user
- Verify email (check Docker logs for OTP)
- Login
- Complete profile
- Submit KYC documents
- Create wallet
- Perform transfer
- Save a beneficiary and confirm the account number is masked in the response
- Schedule a recurring transfer, pause it, resume it, cancel it
- Open `/statements`, change the period, and download the PDF
- Raise a dispute on a transaction and follow it in the admin review queue
- Check the bell menu for in-app notifications produced by those actions

Manual smoke tests of the notification path need the outbox dispatcher, which only
runs inside user-service when `OUTBOX_ENABLED=true` and `NOTIFICATION_SERVICE_URL`
is set. The dev stack wires both; events queued while the services were down are
delivered on the next dispatcher tick.

### Postman / Insomnia Collection

Import OpenAPI specs for automated API testing:

```bash
# Export OpenAPI specs
curl http://localhost:5001/api/v1/openapi.json > auth-api.json
curl http://localhost:5002/api/v1/openapi.json > user-api.json
curl http://localhost:5003/api/v1/kyc/openapi.json > kyc-api.json
curl http://localhost:5004/api/v1/openapi.json > notification-api.json

# Import to Postman:
# File > Import > auth-api.json
```

### Database Inspection

```bash
# Connect to PostgreSQL
docker exec -it banking-system-postgres-1 psql -U auth

# View tables
\c auth_db
\dt

# Query data
SELECT id, email, role, "isEmailVerified" FROM "User";
SELECT id, "userId", balance, currency FROM "Wallet";
SELECT reference, type, status, amount FROM "Transaction" ORDER BY "createdAt" DESC LIMIT 10;
SELECT "eventId", type, "aggregateId", attempts, "publishedAt" FROM "OutboxEvent" ORDER BY "createdAt" DESC LIMIT 10;
SELECT name, "accountNumber", "isFavorite" FROM "Beneficiary";
SELECT id, frequency, status, "nextRunAt", "failureReason" FROM "ScheduledTransfer";
SELECT reference, status, reason FROM "Dispute" ORDER BY "openedAt" DESC LIMIT 10;

\c notification_db
SELECT "eventId", "eventType", "recipientEmail", "emailStatus", "readAt" FROM "Notification" ORDER BY "createdAt" DESC LIMIT 10;
```

### Log Monitoring

```bash
# Follow all service logs
docker compose -f docker-compose.dev.yml logs -f

# Follow specific service
docker compose -f docker-compose.dev.yml logs -f auth-service

# Filter for errors
docker compose -f docker-compose.dev.yml logs | grep -i error
```

---

## Performance Testing

### Load Testing (Future)

Use tools like Apache Bench, k6, or Artillery:

```bash
# Install k6
# https://k6.io/docs/getting-started/installation/

# Simple load test
k6 run --vus 10 --duration 30s tests/load/login.js

# Stress test
k6 run --vus 100 --duration 5m tests/load/transfers.js
```

Example k6 script:

```javascript
// tests/load/login.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export default function () {
  const payload = JSON.stringify({
    email: 'loadtest@example.com',
    password: 'LoadTest123',
  });

  const params = {
    headers: { 'Content-Type': 'application/json' },
  };

  const res = http.post('http://localhost:5001/api/v1/auth/login', payload, params);

  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  sleep(1);
}
```

---

## Troubleshooting Tests

### Test Database Connection Failed

```bash
# Verify PostgreSQL is running
docker compose -f docker-compose.dev.yml ps postgres

# Check logs
docker compose -f docker-compose.dev.yml logs postgres

# Recreate test databases
docker exec -it banking-system-postgres-1 psql -U auth -d postgres -c "DROP DATABASE IF EXISTS auth_test; CREATE DATABASE auth_test;"
```

### Tests Fail With a Prisma P2022

```bash
# The test database schema is behind the migrations in the tree.
(cd backend/user-service && DATABASE_URL="$WALLET_TEST_DATABASE_URL" npx prisma migrate deploy)
(cd backend/kyc-service && DATABASE_URL="$KYC_TEST_DATABASE_URL" npx prisma migrate deploy)
(cd backend/notification-service && DATABASE_URL="$NOTIFICATION_TEST_DATABASE_URL" npx prisma migrate deploy)
```

### Integration Tests Report Skipped

`user-service` skips the cross-service KYC tests when `KYC_TEST_DATABASE_URL` is unset
and lists the reason in the reporter output. Check the variable names in
[Environment Variables for Testing](#environment-variables-for-testing).

### Tests Hanging or Timeout

```bash
# Increase test timeout (if needed)
node --test --test-timeout=60000 tests/slow.test.js

# Check for unclosed database connections
# Ensure test.after() includes:
await prisma.$disconnect();
```

### Prisma Client Not Generated

```bash
cd backend/auth-service
npx prisma generate
```

### Permission Denied on Test Database

```bash
docker exec -it banking-system-postgres-1 psql -U auth -d postgres <<EOF
GRANT ALL PRIVILEGES ON DATABASE auth_test TO meridian;
GRANT ALL PRIVILEGES ON DATABASE user_test TO meridian;
GRANT ALL PRIVILEGES ON DATABASE kyc_test TO meridian;
GRANT ALL PRIVILEGES ON DATABASE notification_test TO meridian;
EOF
```

---

## Best Practices

1. **Isolate Tests** - Each test should be independent
2. **Clean Up** - Always clean up test data in `test.after()`
3. **Use Meaningful Names** - Test names should describe what's being tested
4. **Test One Thing** - Each test should verify one behavior
5. **Arrange-Act-Assert** - Follow AAA pattern for clarity
6. **Don't Test Implementation Details** - Test behavior, not internals
7. **Mock External Services** - Don't rely on third-party APIs in tests
8. **Use Realistic Data** - Test with production-like scenarios
9. **Test Error Paths** - Test both success and failure cases
10. **Fast Tests** - Keep unit tests under 1 second each

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-10-28 | Phase 4 Implementation | Initial testing guide |
| 2.0 | 2026-11-02 | Phase 3 implementation | Notification-service and phase-3 banking suites, full CI gate inventory, refreshed coverage table and troubleshooting |

---

**Next Review Date:** 2026-11-28
