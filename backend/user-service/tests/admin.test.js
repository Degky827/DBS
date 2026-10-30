const testDatabaseUrl = process.env.WALLET_TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("WALLET_TEST_DATABASE_URL must point to an isolated test database");
}
const testDatabaseName = new URL(testDatabaseUrl).pathname
  .split("/")
  .pop()
  .split("?")[0];
if (!/_test$/i.test(testDatabaseName)) {
  throw new Error("Admin tests only run against a database whose name ends in _test");
}

process.env.DATABASE_URL = testDatabaseUrl;
process.env.NODE_ENV = "test";
process.env.AUTH_MODE = "dev";
process.env.DEV_API_KEY = "";
process.env.AUTH_RATE_LIMIT_MAX = "2000";
process.env.RATE_LIMIT_MAX = "20000";

const { createHash, randomBytes, randomUUID } = require("node:crypto");
const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("../src/app");
const prisma = require("../src/config/database");
const kycEligibility = require("../src/services/kycEligibility");
const ledger = require("../src/modules/ledger/ledger.service");

const runId = randomUUID().replace(/-/g, "").slice(0, 10);
const users = {};
const tokens = {};
const wallets = {};
const fixtures = [
  ["customer", "USER"],
  ["sender", "USER"],
  ["receiver", "USER"],
  ["officer", "OFFICER"],
  ["verifier", "VERIFICATION_OFFICER"],
  ["finance", "FINANCIAL_OFFICER"],
  ["admin", "ADMIN"],
];

const paymentReference = `PAY-ADMIN-${runId}`;
let transferReference;

const createUserAndSession = async (label, role) => {
  const suffix = randomUUID().replace(/-/g, "");
  const user = await prisma.userProfile.create({
    data: {
      firstName: label,
      lastName: `Admin${runId}`,
      username: `${label}_${suffix.slice(0, 12)}`,
      email: `${label}_${suffix}@admin.test`,
      phoneNumber: "+15550188",
      dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
      gender: "other",
      passwordHash: "admin-test-only",
      role,
    },
  });
  const token = randomBytes(48).toString("hex");
  await prisma.devSession.create({
    data: {
      userId: user.id,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  users[label] = user;
  tokens[label] = token;
};

const auth = (label) => `Bearer ${tokens[label]}`;
const get = (path, label) =>
  request(app).get(path).set("Authorization", auth(label));

const fundWallet = async (walletId, amount) =>
  prisma.$transaction((tx) =>
    ledger.postEntry({
      tx,
      eventType: "TEST_FUNDING",
      eventRef: `test-funding:${randomUUID()}`,
      currency: "ETB",
      description: "Admin test funding from opening equity",
      postings: [
        {
          accountCode: ledger.ACCOUNT_CODES.OPENING_BALANCE,
          direction: "DEBIT",
          amount,
        },
        { accountCode: `WALLET:${walletId}`, direction: "CREDIT", amount },
      ],
    })
  );

const staffEndpoints = () => [
  "/api/v1/admin/overview",
  "/api/v1/admin/analytics",
  "/api/v1/admin/users",
  `/api/v1/admin/users/${users.sender.id}`,
  "/api/v1/admin/audit-logs",
  "/api/v1/operations/analytics",
  "/api/v1/operations/transactions",
  `/api/v1/operations/transactions/${transferReference}`,
  "/api/v1/operations/payments",
];

const adminOnlyEndpoints = () => [
  "/api/v1/admin/overview",
  "/api/v1/admin/analytics",
  "/api/v1/admin/users",
  `/api/v1/admin/users/${users.sender.id}`,
  "/api/v1/admin/audit-logs",
];

const operationsEndpoints = () => [
  "/api/v1/operations/analytics",
  "/api/v1/operations/transactions",
  `/api/v1/operations/transactions/${transferReference}`,
  "/api/v1/operations/payments",
];

before(async () => {
  kycEligibility.setKycClient({
    async getUserKycStatus() {
      return { status: "APPROVED", isApproved: true };
    },
  });
  await prisma.$connect();
  for (const [label, role] of fixtures) {
    await createUserAndSession(label, role);
  }
  for (const label of ["sender", "receiver"]) {
    wallets[label] = await prisma.wallet.create({ data: { userId: users[label].id } });
  }
  await fundWallet(wallets.sender.id, "100.00");

  const transfer = await request(app)
    .post("/api/v1/transactions/transfers")
    .set("Authorization", auth("sender"))
    .set("Idempotency-Key", `admin-transfer-${runId}`)
    .send({ destinationWalletId: wallets.receiver.id, amount: "10.00" });
  assert.equal(transfer.status, 201);
  transferReference = transfer.body.data.transaction.reference;

  await prisma.payment.create({
    data: {
      reference: paymentReference,
      provider: "CHAPA",
      providerRef: `CHAPA-ADMIN-${runId}`,
      type: "DEPOSIT",
      status: "PENDING",
      amount: "25.00",
      currency: "ETB",
      idempotencyKey: `admin-deposit-${runId}`,
      userId: users.sender.id,
      walletId: wallets.sender.id,
    },
  });
});

after(async () => {
  kycEligibility.setKycClient(null);
  const userIds = fixtures.map(([label]) => users[label]?.id).filter(Boolean);
  try {
    // Ledger and audit fixtures stay in the disposable test database because
    // posted financial records are immutable; sessions are revoked instead.
    await prisma.devSession.deleteMany({ where: { userId: { in: userIds } } });
  } finally {
    await prisma.$disconnect();
  }
});

test("staff endpoints reject unauthenticated requests", async () => {
  for (const path of staffEndpoints()) {
    const response = await request(app).get(path);
    assert.equal(response.status, 401, path);
    assert.equal(response.body.code, "TOKEN_MISSING", path);
  }
});

test("staff endpoints enforce the documented role matrix", async () => {
  for (const label of ["customer", "officer", "verifier"]) {
    for (const path of staffEndpoints()) {
      const response = await get(path, label);
      assert.equal(response.status, 403, `${label} ${path}`);
      assert.equal(response.body.code, "FORBIDDEN_ROLE", `${label} ${path}`);
    }
  }

  for (const path of adminOnlyEndpoints()) {
    const response = await get(path, "finance");
    assert.equal(response.status, 403, `finance ${path}`);
    assert.equal(response.body.code, "FORBIDDEN_ROLE", `finance ${path}`);
  }
  for (const path of operationsEndpoints()) {
    const response = await get(path, "finance");
    assert.equal(response.status, 200, `finance ${path}`);
  }

  for (const path of staffEndpoints()) {
    const response = await get(path, "admin");
    assert.equal(response.status, 200, `admin ${path}`);
  }
});

test("admin overview reports platform totals for a bounded period", async () => {
  const response = await get("/api/v1/admin/overview?days=7", "admin");
  assert.equal(response.status, 200);
  const data = response.body.data;

  assert.equal(data.period.days, 7);
  assert.ok(data.users.total >= fixtures.length);
  assert.ok(data.users.newInPeriod >= fixtures.length);
  assert.ok(data.wallets.total >= 2);
  assert.ok(data.transactions.total >= 1);
  assert.ok(data.payments.total >= 1);
  assert.ok(data.policies.active >= 3);
  assert.equal(typeof data.withdrawals.pending, "number");
  assert.equal(typeof data.reversals.inPeriod, "number");

  const etb = data.transactions.byCurrency.find((row) => row.currency === "ETB");
  assert.ok(etb);
  assert.equal(typeof etb.amount, "string");
  assert.ok(data.transactions.byStatus.some((row) => row.value === "POSTED"));
  assert.ok(data.payments.byStatus.some((row) => row.value === "PENDING"));
});

test("admin overview and analytics reject invalid period input", async () => {
  for (const path of ["/api/v1/admin/overview", "/api/v1/admin/analytics"]) {
    for (const query of ["?days=0", "?days=366", "?days=abc", "?days=7&extra=1"]) {
      const response = await get(`${path}${query}`, "admin");
      assert.equal(response.status, 400, `${path}${query}`);
      assert.equal(response.body.code, "VALIDATION_ERROR", `${path}${query}`);
    }
  }
});

test("admin analytics returns labelled daily series for the requested period", async () => {
  const response = await get("/api/v1/admin/analytics?days=7", "admin");
  assert.equal(response.status, 200);
  const data = response.body.data;

  assert.equal(data.transactionsByDay.length, 7);
  assert.equal(data.paymentsByDay.length, 7);
  assert.equal(data.registrations.length, 7);
  for (const day of data.transactionsByDay) {
    assert.match(day.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(typeof day.count, "number");
    assert.ok(Array.isArray(day.volumeByCurrency));
  }
  for (const day of data.paymentsByDay) {
    assert.equal(typeof day.completed, "number");
    assert.equal(typeof day.pending, "number");
    assert.equal(typeof day.failed, "number");
  }
  assert.ok(Array.isArray(data.transactionTypes));
  assert.ok(data.transactionTypes.every((row) => typeof row.value === "string"));
  assert.ok(Array.isArray(data.paymentAmounts));
  assert.ok(Array.isArray(data.volumeByCurrency));
  assert.ok(Array.isArray(data.withdrawals.byStatus));
  assert.ok(Array.isArray(data.reversals.byCurrency));
});

test("admin user directory searches, filters, paginates, and hides secrets", async () => {
  const search = await get(`/api/v1/admin/users?q=${runId}`, "admin");
  assert.equal(search.status, 200);
  assert.equal(search.body.data.page.total, fixtures.length);
  assert.equal(search.body.data.page.limit, 25);
  assert.equal(search.body.data.page.hasMore, false);
  for (const user of search.body.data.users) {
    assert.equal(user.passwordHash, undefined);
    assert.equal(user.lastName, `Admin${runId}`);
    assert.equal(typeof user.counts.transactions, "number");
  }

  const firstPage = await get(`/api/v1/admin/users?q=${runId}&limit=5`, "admin");
  assert.equal(firstPage.status, 200);
  assert.equal(firstPage.body.data.users.length, 5);
  assert.equal(firstPage.body.data.page.hasMore, true);
  const cursor = firstPage.body.data.page.nextCursor;
  assert.equal(typeof cursor, "string");

  const secondPage = await get(
    `/api/v1/admin/users?q=${runId}&limit=5&cursor=${cursor}`,
    "admin"
  );
  assert.equal(secondPage.status, 200);
  assert.equal(secondPage.body.data.users.length, fixtures.length - 5);
  const seen = new Set(
    [...firstPage.body.data.users, ...secondPage.body.data.users].map((user) => user.id)
  );
  assert.equal(seen.size, fixtures.length);

  const filtered = await get(
    `/api/v1/admin/users?q=${runId}&role=FINANCIAL_OFFICER`,
    "admin"
  );
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.data.page.total, 1);
  assert.equal(filtered.body.data.users[0].id, users.finance.id);

  const invalidCursor = await get(
    `/api/v1/admin/users?cursor=${randomUUID()}`,
    "admin"
  );
  assert.equal(invalidCursor.status, 400);
  assert.equal(invalidCursor.body.code, "INVALID_USER_CURSOR");

  const invalidRole = await get("/api/v1/admin/users?role=SUPERUSER", "admin");
  assert.equal(invalidRole.status, 400);
  assert.equal(invalidRole.body.code, "VALIDATION_ERROR");
});

test("admin user detail includes the wallet projection and recent activity", async () => {
  const response = await get(`/api/v1/admin/users/${users.sender.id}`, "admin");
  assert.equal(response.status, 200);
  const data = response.body.data;

  assert.equal(data.user.id, users.sender.id);
  assert.equal(data.user.role, "USER");
  assert.equal(data.user.passwordHash, undefined);
  assert.equal(typeof data.user.phoneNumber, "string");
  assert.equal(data.user.wallet.currency, "ETB");
  assert.equal(typeof data.user.wallet.balance, "string");
  assert.ok(data.recentTransactions.length >= 1);
  assert.ok(
    data.recentTransactions.some((row) => row.reference === transferReference)
  );

  const missing = await get(`/api/v1/admin/users/${randomUUID()}`, "admin");
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, "USER_NOT_FOUND");

  const malformed = await get("/api/v1/admin/users/not-a-uuid", "admin");
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.code, "VALIDATION_ERROR");
});

test("operations transaction list and detail expose ledger-backed records", async () => {
  const list = await get(
    `/api/v1/operations/transactions?q=${encodeURIComponent(transferReference)}`,
    "finance"
  );
  assert.equal(list.status, 200);
  const body = list.body.data;
  assert.ok(body.summary.total >= 1);
  assert.equal(typeof body.summary.volume, "string");
  assert.equal(typeof body.summary.fees, "string");
  assert.equal(body.page.hasMore, false);
  assert.ok(body.transactions.some((row) => row.reference === transferReference));
  assert.ok(body.summary.byStatus.some((row) => row.value === "POSTED"));
  assert.ok(body.summary.byType.some((row) => row.value === "TRANSFER"));
  assert.ok(body.summary.byCurrency.some((row) => row.currency === "ETB"));

  const detail = await get(
    `/api/v1/operations/transactions/${transferReference}`,
    "finance"
  );
  assert.equal(detail.status, 200);
  const transaction = detail.body.data.transaction;
  assert.equal(transaction.reference, transferReference);
  assert.equal(transaction.status, "POSTED");
  assert.equal(transaction.amount, "10.00");
  assert.equal(transaction.currency, "ETB");
  assert.match(transaction.journalEntry.reference, /^JRN-/);
  assert.equal(transaction.journalEntry.status, "POSTED");
  assert.equal(transaction.sourceWallet.id, wallets.sender.id);
  assert.equal(transaction.destinationWallet.id, wallets.receiver.id);
  assert.equal(transaction.destinationWallet.userId, users.receiver.id);
  assert.deepEqual(transaction.reversals, []);
  assert.equal(transaction.payment, null);

  const missing = await get("/api/v1/operations/transactions/UNKNOWN-REF", "finance");
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, "TRANSACTION_NOT_FOUND");
});

test("operations transaction filters validate input", async () => {
  const cases = [
    "?q=ab",
    "?type=REFUND",
    "?status=UNKNOWN",
    "?from=2026-01-02T00:00:00Z&to=2026-01-01T00:00:00Z",
    "?from=not-a-date",
    "?limit=0",
  ];
  for (const query of cases) {
    const response = await get(`/api/v1/operations/transactions${query}`, "finance");
    assert.equal(response.status, 400, query);
    assert.equal(response.body.code, "VALIDATION_ERROR", query);
  }
});

test("operations payments list real provider records with summaries", async () => {
  const response = await get(
    "/api/v1/operations/payments?status=PENDING",
    "finance"
  );
  assert.equal(response.status, 200);
  const data = response.body.data;

  const payment = data.payments.find((row) => row.reference === paymentReference);
  assert.ok(payment);
  assert.equal(payment.status, "PENDING");
  assert.equal(payment.amount, "25.00");
  assert.equal(payment.provider, "CHAPA");
  assert.equal(payment.user.id, users.sender.id);
  assert.equal(payment.wallet.id, wallets.sender.id);
  assert.ok(
    data.summary.byStatus.some(
      (row) => row.value === "PENDING" && typeof row.amount === "string"
    )
  );

  const invalid = await get("/api/v1/operations/payments?status=REFUNDED", "finance");
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.code, "VALIDATION_ERROR");

  const invalidCursor = await get(
    `/api/v1/operations/payments?cursor=${randomUUID()}`,
    "finance"
  );
  assert.equal(invalidCursor.status, 400);
  assert.equal(invalidCursor.body.code, "INVALID_PAYMENT_CURSOR");
});

test("admin audit trail is read-only, filterable, and references policy changes", async () => {
  const policy = await prisma.financialPolicy.findUnique({
    where: { type_currency: { type: "TRANSFER", currency: "ETB" } },
  });
  const patch = await request(app)
    .patch("/api/v1/admin/financial-policies/TRANSFER")
    .set("Authorization", auth("admin"))
    .send({
      timezone: policy.timezone,
      reason: "Admin dashboard audit verification",
    });
  assert.equal(patch.status, 200);

  const response = await get(
    `/api/v1/admin/audit-logs?source=FINANCIAL_POLICY&actorId=${users.admin.id}`,
    "admin"
  );
  assert.equal(response.status, 200);
  const data = response.body.data;
  assert.equal(data.truncated, false);
  assert.ok(data.logs.length >= 1);
  const latest = data.logs[0];
  assert.equal(latest.source, "FINANCIAL_POLICY");
  assert.equal(latest.actorId, users.admin.id);
  assert.equal(latest.action, "FINANCIAL_POLICY_UPDATED");
  assert.equal(latest.target, "TRANSFER ETB");
  assert.equal(latest.outcome, "SUCCESS");
  assert.equal(latest.detail, "Admin dashboard audit verification");
  assert.equal(latest.snapshot, undefined);
  assert.equal(latest.changedBy, undefined);

  const paged = await get(
    "/api/v1/admin/audit-logs?source=FINANCIAL_POLICY&limit=1&page=2",
    "admin"
  );
  assert.equal(paged.status, 200);
  assert.equal(paged.body.data.page.page, 2);
  assert.equal(paged.body.data.page.limit, 1);
  assert.ok(paged.body.data.logs.length <= 1);
  assert.ok(paged.body.data.page.totalPages >= 1);

  const future = await get(
    "/api/v1/admin/audit-logs?from=2099-01-01T00:00:00Z",
    "admin"
  );
  assert.equal(future.status, 200);
  assert.equal(future.body.data.page.total, 0);

  for (const query of [
    "?source=UNKNOWN",
    "?page=0",
    "?limit=0",
    "?from=not-a-date",
    "?from=2026-01-02T00:00:00Z&to=2026-01-01T00:00:00Z",
  ]) {
    const invalid = await get(`/api/v1/admin/audit-logs${query}`, "admin");
    assert.equal(invalid.status, 400, query);
    assert.equal(invalid.body.code, "VALIDATION_ERROR", query);
  }
});

test("reversals recorded by an administrator appear in transactions and audit logs", async () => {
  const reversal = await request(app)
    .post(`/api/v1/transactions/${transferReference}/reversals`)
    .set("Authorization", auth("admin"))
    .set("Idempotency-Key", `admin-reversal-${runId}`)
    .send({ amount: "4.00", reason: "Admin dashboard verification" });
  assert.equal(reversal.status, 201);
  assert.equal(reversal.body.data.reversal.amount, "4.00");

  const detail = await get(
    `/api/v1/operations/transactions/${transferReference}`,
    "admin"
  );
  assert.equal(detail.status, 200);
  const transaction = detail.body.data.transaction;
  assert.equal(transaction.status, "PARTIALLY_REVERSED");
  assert.equal(transaction.reversedAmount, "4.00");
  assert.equal(transaction.reversals.length, 1);
  assert.equal(transaction.reversals[0].reason, "Admin dashboard verification");

  const filtered = await get(
    `/api/v1/operations/transactions?q=${encodeURIComponent(transferReference)}&status=PARTIALLY_REVERSED`,
    "admin"
  );
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.data.summary.total, 1);

  const audit = await get(
    `/api/v1/admin/audit-logs?source=TRANSACTION_REVERSAL&actorId=${users.admin.id}`,
    "admin"
  );
  assert.equal(audit.status, 200);
  const entry = audit.body.data.logs.find(
    (row) => row.target === transferReference
  );
  assert.ok(entry);
  assert.equal(entry.action, "TRANSACTION_REVERSED");
  assert.equal(entry.outcome, "SUCCESS");
  assert.match(entry.detail, /^4\.00 ETB — Admin dashboard verification$/);
});
