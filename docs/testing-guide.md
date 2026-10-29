# Testing Guide
## Meridian Digital Banking Platform

**Version:** 1.0  
**Last Updated:** 2026-10-28

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

### What We Don't Test

- ✗ Third-party library internals
- ✗ Node.js/Express.js framework behavior
- ✗ PostgreSQL transaction guarantees
- ✗ Docker networking

---

## Test Infrastructure

### Backend Test Databases

Tests require isolated PostgreSQL databases:

```bash
# Development PostgreSQL (via Docker)
docker compose -f docker-compose.dev.yml up -d postgres

# Create test databases
docker exec -it meridian-dev-postgres-1 psql -U meridian -d postgres <<EOF
CREATE DATABASE auth_test;
CREATE DATABASE user_test;
CREATE DATABASE kyc_test;
EOF

# Grant permissions
docker exec -it meridian-dev-postgres-1 psql -U meridian -d postgres <<EOF
GRANT ALL PRIVILEGES ON DATABASE auth_test TO meridian;
GRANT ALL PRIVILEGES ON DATABASE user_test TO meridian;
GRANT ALL PRIVILEGES ON DATABASE kyc_test TO meridian;
EOF
```

### Environment Variables for Testing

```bash
# Auth Service Tests
export DATABASE_URL="postgresql://meridian:password@localhost:5432/auth_test?schema=public"
export JWT_SECRET="test-jwt-secret-0123456789abcdef0123456789abcdef"
export INTERNAL_SERVICE_KEY="test-internal-key-0123456789abcdef"
export NODE_ENV="test"

# User Service Tests (Integration)
export WALLET_TEST_DATABASE_URL="postgresql://meridian:password@localhost:5432/user_test?schema=public"

# KYC Service Tests
export STORAGE_ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
```

### Test Database Safety

All test databases MUST end in `_test`:

```javascript
const testDatabaseName = new URL(testDatabaseUrl).pathname.split("/").pop();
if (!/_test$/i.test(testDatabaseName)) {
  throw new Error("Tests only run against databases ending in _test");
}
```

This prevents accidentally running destructive tests against production or development databases.

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

# Unit tests (mocked)
npm test

# Integration tests (require PostgreSQL)
npm run test:wallets
npm run test:financial-integrity
npm run test:payments
npm run test:kyc

# All tests
npm run test:all
```

#### KYC Service

```bash
cd backend/kyc-service

# All tests
npm test

# OCR smoke test (downloads Tesseract data)
npm run test:ocr
```

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
for path in /api/auth/health /api/user/health /api/kyc/health; do
    curl -fsS "http://localhost:8080${path}" >/dev/null || { echo "FAILED ${path}"; exit 1; }
done

# End-to-end tests are not implemented yet
# cd frontend
# npm run test:e2e
```

### Running Tests in CI

Tests run automatically via GitHub Actions on every pull request. See `.github/workflows/ci.yml`.

```bash
# Simulate CI locally
# Install dependencies
cd backend/auth-service && npm ci && cd ../..
cd backend/user-service && npm ci && cd ../..
cd backend/kyc-service && npm ci && cd ../..
cd frontend && npm ci && cd ..

# Run linting
cd frontend && npm run lint && cd ..
cd backend/auth-service && npm run lint && cd ../..
cd backend/user-service && npm run lint && cd ../..
cd backend/kyc-service && npm run lint && cd ../..

# Run tests
cd backend/auth-service && npm test && cd ../..
cd backend/user-service && npm run test:all && cd ../..
cd backend/kyc-service && npm test && cd ../..
cd frontend && npm test && cd ..
```

---

## Test Coverage

### Current Coverage (as of 2026-10-28)

| Service | Test Files | Coverage | Key Areas |
|---------|-----------|----------|-----------|
| **Auth Service** | 6 | ★★★★☆ | Security, refresh tokens, OTP, password reset, rate limiting |
| **User Service** | 8 | ★★★★★ | Wallets, transfers, concurrency, idempotency, financial integrity, KYC eligibility |
| **KYC Service** | 8 | ★★★★☆ | Documents, submissions, OCR, verification workflow, security |
| **Frontend** | 1 | ★☆☆☆☆ | Redux auth slice only |

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

✅ **KYC Workflow**
- Document upload with encryption
- Access control (owner + officer)
- OCR text extraction
- Submission lifecycle
- Provider integration
- Webhook security

### Gaps (Future Enhancements)

❌ **Not Yet Tested**
- End-to-end user journeys
- Frontend component rendering
- Error boundaries
- Accessibility (WCAG)
- Load testing
- Chaos engineering
- External provider integration (Chapa, Didit)

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

See `.github/workflows/ci.yml` for full CI pipeline.

**Pipeline Stages:**

1. **Lint** - ESLint and Prettier checks
2. **Test Auth** - Auth service unit and integration tests
3. **Test User** - User service tests (including wallet integration)
4. **Test KYC** - KYC service tests
5. **Test Frontend** - Frontend unit tests
6. **Build Frontend** - Production build
7. **Build Docker Images** - All service images
8. **Validate OpenAPI** - API specification validation
9. **Security Audit** - Dependency vulnerability scan

### Running CI Locally

```bash
# Install Act (GitHub Actions local runner)
# https://github.com/nektos/act

# Run CI workflow locally
act pull_request

# Run specific job
act -j test-auth-service
act -j test-user-service
```

### Branch Protection

Configure branch protection for `main`:

- ✓ Require pull request reviews
- ✓ Require status checks to pass:
  - `lint`
  - `test-auth-service`
  - `test-user-service`
  - `test-kyc-service`
  - `test-frontend`
  - `build-frontend`
  - `build-docker-images`
  - `validate-openapi`
- ✓ Require branches to be up to date
- ✓ No force pushes
- ✓ No deletion

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

# API Documentation
open http://localhost:5001/api/v1/docs
open http://localhost:5002/api/v1/docs
open http://localhost:5003/api/v1/kyc/docs

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

### Postman / Insomnia Collection

Import OpenAPI specs for automated API testing:

```bash
# Export OpenAPI specs
curl http://localhost:5001/api/v1/openapi.json > auth-api.json
curl http://localhost:5002/api/v1/openapi.json > user-api.json
curl http://localhost:5003/api/v1/kyc/openapi.json > kyc-api.json

# Import to Postman:
# File > Import > auth-api.json
```

### Database Inspection

```bash
# Connect to PostgreSQL
docker exec -it meridian-dev-postgres-1 psql -U meridian

# View tables
\c auth_db
\dt

# Query data
SELECT id, email, role, "isEmailVerified" FROM "User";
SELECT id, "userId", balance, currency FROM "Wallet";
SELECT reference, type, status, amount FROM "Transaction" ORDER BY "createdAt" DESC LIMIT 10;
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
docker exec -it meridian-dev-postgres-1 psql -U meridian -d postgres -c "DROP DATABASE IF EXISTS auth_test; CREATE DATABASE auth_test;"
```

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
docker exec -it meridian-dev-postgres-1 psql -U meridian -d postgres <<EOF
GRANT ALL PRIVILEGES ON DATABASE auth_test TO meridian;
GRANT ALL PRIVILEGES ON DATABASE user_test TO meridian;
GRANT ALL PRIVILEGES ON DATABASE kyc_test TO meridian;
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

---

**Next Review Date:** 2026-11-28
