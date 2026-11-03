const testDatabaseUrl = process.env.WALLET_TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("WALLET_TEST_DATABASE_URL must point to an isolated test database");
}
const testDatabaseName = new URL(testDatabaseUrl).pathname.split("/").pop().split("?")[0];
if (!/_test$/i.test(testDatabaseName)) {
  throw new Error("Ledger verification tests only run against a database whose name ends in _test");
}

process.env.DATABASE_URL = testDatabaseUrl;
process.env.NODE_ENV = "test";
process.env.AUTH_MODE = "dev";
process.env.DEV_API_KEY = "";
process.env.AUTH_RATE_LIMIT_MAX = "2000";
process.env.RATE_LIMIT_MAX = "20000";
// The integrity alert travels through the outbox, so the dispatcher's producer
// side has to be on. Nothing is delivered: the URL points at a closed port and
// the dispatcher itself is never started here.
process.env.OUTBOX_ENABLED = "true";
process.env.NOTIFICATION_SERVICE_URL = "http://127.0.0.1:1";
process.env.INTERNAL_SERVICE_KEY = "ledger-verification-test-key";

const { createHash, randomBytes, randomUUID } = require("node:crypto");
const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("../src/app");
const prisma = require("../src/config/database");
const ledger = require("../src/modules/ledger/ledger.service");
const ledgerVerify = require("../src/modules/ledger/ledgerVerify.service");
const ledgerJob = require("../src/modules/ledger/ledgerVerify.job");
const { CHECK_GROUPS } = require("../src/modules/ledger/ledgerChecks");
const metrics = require("../src/utils/metrics");

const runId = randomUUID().replace(/-/g, "").slice(0, 10);
const users = {};
const tokens = {};
const wallets = {};
const injected = { transactionIds: [], withdrawalIds: [], payoutIds: [] };

const fixtures = [
  ["admin", "ADMIN"],
  ["finance", "FINANCIAL_OFFICER"],
  ["customer", "USER"],
  ["counterparty", "USER"],
];

const TOTAL_CHECKS = Object.values(CHECK_GROUPS).flat().length;
const BASE = "/api/v1/admin/ledger";
let baselineFailingCount = 0;

const createUserAndSession = async (label, role) => {
  const suffix = randomUUID().replace(/-/g, "");
  const user = await prisma.userProfile.create({
    data: {
      firstName: label,
      lastName: `Verify${runId}`,
      username: `${label}_${suffix.slice(0, 12)}`,
      email: `${label}_${suffix}@verify.test`,
      phoneNumber: "+15550177",
      dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
      gender: "other",
      passwordHash: "verify-test-only",
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

const postRun = (label = "admin") =>
  request(app).post(`${BASE}/verification/runs`).set("Authorization", auth(label)).send({});

const failingCount = (run) =>
  (run.summary?.bySeverity?.CRITICAL || 0) + (run.summary?.bySeverity?.HIGH || 0);

const classificationsOf = (run) => run.issues.map((issue) => issue.classification);

// Deliberately broken rows. Each one is a state the ledger triggers cannot
// prevent on their own: an aggregate that drifted, or a record written outside
// the accounting path.
const injectTransactionWithoutEntry = async () => {
  const transaction = await prisma.transaction.create({
    data: {
      initiatedByUserId: users.customer.id,
      sourceWalletId: wallets.counterparty.id,
      destinationWalletId: wallets.customer.id,
      type: "TRANSFER",
      amount: "3.00",
      currency: "ETB",
      status: "POSTED",
      idempotencyKey: `verify-orphan-${runId}`,
    },
  });
  injected.transactionIds.push(transaction.id);
  return transaction;
};

const injectWithdrawalWithoutReservation = async () => {
  const withdrawal = await prisma.withdrawal.create({
    data: {
      userId: users.customer.id,
      walletId: wallets.customer.id,
      amount: "4.00",
      currency: "ETB",
      status: "PENDING",
      idempotencyKey: `verify-unreserved-${runId}`,
    },
  });
  injected.withdrawalIds.push(withdrawal.id);
  return withdrawal;
};

const injectPayoutWithoutSettlement = async (withdrawalId) => {
  const payout = await prisma.payout.create({
    data: {
      userId: users.customer.id,
      walletId: wallets.customer.id,
      withdrawalId,
      destinationAccount: `verify-dest-${runId}`,
      destinationName: "Verification fixture",
      amount: "4.00",
      currency: "ETB",
      status: "PROCESSING",
      provider: "MOCK",
      idempotencyKey: `verify-payout-${runId}`,
      requestedAt: new Date(Date.now() - 120_000),
      sentAt: new Date(Date.now() - 60_000),
    },
  });
  injected.payoutIds.push(payout.id);
  return payout;
};

const findIssue = async (classification, aggregateId) =>
  prisma.ledgerVerificationIssue.findFirst({
    where: { classification, aggregateId: String(aggregateId) },
    orderBy: { detectedAt: "desc" },
  });

const alertEvents = () =>
  prisma.outboxEvent.findMany({
    where: { type: ledgerVerify.ALERT_EVENT_TYPE },
    orderBy: { createdAt: "asc" },
  });

before(async () => {
  await prisma.$connect();
  for (const [label, role] of fixtures) {
    await createUserAndSession(label, role);
  }
  wallets.customer = await prisma.wallet.create({ data: { userId: users.customer.id } });
  wallets.counterparty = await prisma.wallet.create({ data: { userId: users.counterparty.id } });
  await prisma.$transaction((tx) =>
    ledger.postEntry({
      tx,
      eventType: "TEST_FUNDING",
      eventRef: `test-funding:${randomUUID()}`,
      currency: "ETB",
      description: "Ledger verification test funding",
      postings: [
        { accountCode: ledger.ACCOUNT_CODES.OPENING_BALANCE, direction: "DEBIT", amount: "50.00" },
        { accountCode: `WALLET:${wallets.customer.id}`, direction: "CREDIT", amount: "50.00" },
      ],
    })
  );

  // Other suites share this disposable database and leave their own fixtures
  // behind, so the assertions below compare against a baseline instead of
  // assuming an empty book.
  const baseline = await ledgerVerify.runVerification({ trigger: "MANUAL" });
  baselineFailingCount = failingCount(baseline);
});

after(async () => {
  await prisma.payout.deleteMany({ where: { id: { in: injected.payoutIds } } });
  await prisma.withdrawal.deleteMany({ where: { id: { in: injected.withdrawalIds } } });
  await prisma.transaction.deleteMany({ where: { id: { in: injected.transactionIds } } });
  await prisma.outboxEvent.deleteMany({ where: { type: ledgerVerify.ALERT_EVENT_TYPE } });
  await prisma.ledgerVerificationRun.deleteMany({});
  const userIds = fixtures.map(([label]) => users[label]?.id).filter(Boolean);
  await prisma.devSession.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.$disconnect();
});

test("ledger endpoints reject unauthenticated and customer callers", async () => {
  for (const path of [
    `${BASE}/integrity`,
    `${BASE}/verification/runs`,
    `${BASE}/verification/issues`,
  ]) {
    const anonymous = await request(app).get(path);
    assert.equal(anonymous.status, 401, path);

    const customer = await request(app).get(path).set("Authorization", auth("customer"));
    assert.equal(customer.status, 403, path);
    assert.equal(customer.body.code, "FORBIDDEN_ROLE", path);
  }

  const start = await postRun("customer");
  assert.equal(start.status, 403);
  assert.equal(start.body.code, "FORBIDDEN_ROLE");
});

test("integrity overview reports live aggregates, not samples", async () => {
  const response = await request(app)
    .get(`${BASE}/integrity`)
    .set("Authorization", auth("finance"));
  assert.equal(response.status, 200);
  const overview = response.body.data;

  assert.equal(overview.checksAvailable, TOTAL_CHECKS);
  assert.equal(typeof overview.jobEnabled, "boolean");
  assert.ok(overview.latestRun, "a verification run must exist after the baseline");
  assert.ok(Array.isArray(overview.totals.platformAccounts));
  const codes = overview.totals.platformAccounts.map((account) => account.code);
  assert.ok(codes.includes(ledger.ACCOUNT_CODES.PAYOUT_SETTLEMENT), codes.join(","));
  assert.ok(codes.includes(ledger.ACCOUNT_CODES.WITHDRAWAL_RESERVED), codes.join(","));
  assert.equal(typeof overview.totals.debits, "string");
  assert.equal(overview.totals.difference, "0.00");
});

test("financial officer can trigger a verification run and it is recorded", async () => {
  const response = await postRun("finance");
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const run = response.body.data.run;

  assert.equal(run.trigger, "MANUAL");
  assert.equal(run.actorUserId, users.finance.id);
  assert.equal(run.checksRun, TOTAL_CHECKS);
  assert.deepEqual(run.summary.checkErrors, []);
  assert.ok(run.finishedAt);
  assert.ok(run.durationMs >= 0);
  assert.ok(["PASSED", "FAILED"].includes(run.status), run.status);
  // The fixtures created by other suites must not change the verdict.
  assert.equal(failingCount(run), baselineFailingCount);

  const stored = await prisma.ledgerVerificationRun.findUnique({
    where: { id: run.id },
    include: { issues: true },
  });
  assert.equal(stored.issuesFound, stored.issues.length);
  assert.equal(stored.status, run.status);
});

test("run history is listable and fetchable by reference", async () => {
  const created = (await postRun()).body.data.run;

  const list = await request(app)
    .get(`${BASE}/verification/runs?limit=5`)
    .set("Authorization", auth("admin"));
  assert.equal(list.status, 200);
  assert.ok(list.body.data.runs.length >= 2);
  assert.ok(list.body.data.runs.every((row) => row.reference));
  assert.equal(list.body.data.runs[0].id, created.id, "newest run first");

  const filtered = await request(app)
    .get(`${BASE}/verification/runs?trigger=CI`)
    .set("Authorization", auth("admin"));
  assert.equal(filtered.status, 200);
  // The filter must return CI runs and nothing else. It cannot be asserted as
  // empty: a recorded CI run or an operator's `verifyLedger --record` may have
  // written history into this database independently of this suite.
  assert.ok(filtered.body.data.runs.every((row) => row.trigger === "CI"));
  assert.equal(
    filtered.body.data.runs.some((row) => row.id === created.id),
    false,
    "a MANUAL run does not appear under trigger=CI"
  );

  const detail = await request(app)
    .get(`${BASE}/verification/runs/${created.reference}`)
    .set("Authorization", auth("finance"));
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.run.id, created.id);
  assert.ok(Array.isArray(detail.body.data.run.issues));

  const missing = await request(app)
    .get(`${BASE}/verification/runs/LVR-does-not-exist`)
    .set("Authorization", auth("admin"));
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, "VERIFICATION_RUN_NOT_FOUND");
});

test("query validation rejects unknown filters", async () => {
  const response = await request(app)
    .get(`${BASE}/verification/runs?status=NOT_A_STATUS`)
    .set("Authorization", auth("admin"));
  assert.equal(response.status, 400);
  assert.equal(response.body.code, "VALIDATION_ERROR");

  const issues = await request(app)
    .get(`${BASE}/verification/issues?severity=EXTREME`)
    .set("Authorization", auth("admin"));
  assert.equal(issues.status, 400);
  assert.equal(issues.body.code, "VALIDATION_ERROR");
});

test("a transaction without its journal entry fails verification and opens an issue", async () => {
  const alertsBefore = (await alertEvents()).length;
  const transaction = await injectTransactionWithoutEntry();

  const response = await postRun();
  assert.equal(response.status, 200);
  const run = response.body.data.run;
  assert.equal(run.status, "FAILED");
  assert.equal(run.errorMessage, null);
  assert.ok(classificationsOf(run).includes("TRANSACTION_WITHOUT_JOURNAL_ENTRY"));

  const issue = await findIssue("TRANSACTION_WITHOUT_JOURNAL_ENTRY", transaction.id);
  assert.ok(issue, "the inconsistency must be recorded");
  assert.equal(issue.severity, "CRITICAL");
  assert.equal(issue.status, "OPEN");
  assert.equal(issue.runId, run.id);
  assert.deepEqual(issue.details.reference, transaction.reference);

  // An alert is only useful if it reaches the people who can act on it.
  const events = await alertEvents();
  assert.equal(events.length, alertsBefore + 1, "one alert per newly detected failure");
  const alert = events[events.length - 1];
  assert.equal(alert.payload.runReference, run.reference);
  assert.ok(
    alert.payload.recipients.some((recipient) => recipient.email === users.admin.email),
    "the alert must reach the administrator who can act on it"
  );
  assert.ok(alert.payload.recipients.every((recipient) => recipient.email));
  assert.ok(
    alert.payload.newIssues.some(
      (entry) =>
        entry.classification === "TRANSACTION_WITHOUT_JOURNAL_ENTRY" &&
        entry.aggregateId === transaction.id
    ),
    JSON.stringify(alert.payload.newIssues)
  );
});

test("a carried inconsistency is not re-opened and does not re-alert", async () => {
  const beforeRuns = await prisma.ledgerVerificationRun.count();
  const beforeIssues = await prisma.ledgerVerificationIssue.count();
  const beforeAlerts = (await alertEvents()).length;

  const response = await postRun();
  const run = response.body.data.run;
  assert.equal(run.status, "FAILED", "the ledger is still inconsistent");
  assert.equal(run.issuesFound, 0);
  assert.equal(run.summary.newIssueCount, 0);
  assert.ok(run.summary.carriedIssueCount >= 1);

  assert.equal(await prisma.ledgerVerificationRun.count(), beforeRuns + 1);
  assert.equal(await prisma.ledgerVerificationIssue.count(), beforeIssues);
  assert.equal((await alertEvents()).length, beforeAlerts, "no alert spam for a known problem");
});

test("an inconsistency can be acknowledged but not silently closed", async () => {
  const issue = await findIssue("TRANSACTION_WITHOUT_JOURNAL_ENTRY", injected.transactionIds[0]);

  const noNote = await request(app)
    .post(`${BASE}/verification/issues/${issue.id}/resolve`)
    .set("Authorization", auth("admin"))
    .send({});
  assert.equal(noNote.status, 400);
  assert.equal(noNote.body.code, "VERIFICATION_ISSUE_NOTE_REQUIRED");

  const shortNote = await request(app)
    .post(`${BASE}/verification/issues/${issue.id}/resolve`)
    .set("Authorization", auth("admin"))
    .send({ note: "ok" });
  assert.equal(shortNote.status, 400);
  assert.equal(shortNote.body.code, "VALIDATION_ERROR");

  const acknowledged = await request(app)
    .post(`${BASE}/verification/issues/${issue.id}/acknowledge`)
    .set("Authorization", auth("finance"));
  assert.equal(acknowledged.status, 200);
  assert.equal(acknowledged.body.data.issue.status, "ACKNOWLEDGED");
  assert.equal(acknowledged.body.data.issue.acknowledgedBy, users.finance.id);

  const again = await request(app)
    .post(`${BASE}/verification/issues/${issue.id}/acknowledge`)
    .set("Authorization", auth("finance"));
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "VERIFICATION_ISSUE_STATE_CONFLICT");
});

test("resolution re-opens the issue on the next run", async () => {
  const issue = await findIssue("TRANSACTION_WITHOUT_JOURNAL_ENTRY", injected.transactionIds[0]);
  const resolved = await request(app)
    .post(`${BASE}/verification/issues/${issue.id}/resolve`)
    .set("Authorization", auth("admin"))
    .send({ note: "Transaction deleted together with the fixture row" });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.data.issue.status, "RESOLVED");
  assert.equal(resolved.body.data.issue.resolvedBy, users.admin.id);

  const run = (await postRun()).body.data.run;
  assert.equal(run.status, "FAILED");
  assert.ok(run.issuesFound >= 1, "a resolved finding that is still true re-opens");

  const reopened = await findIssue("TRANSACTION_WITHOUT_JOURNAL_ENTRY", injected.transactionIds[0]);
  assert.equal(reopened.status, "OPEN");
  assert.notEqual(reopened.id, issue.id);
});

test("withdrawal without a reservation and in-flight payout are both reported", async () => {
  const withdrawal = await injectWithdrawalWithoutReservation();
  const payout = await injectPayoutWithoutSettlement(withdrawal.id);

  const run = (await postRun()).body.data.run;
  assert.equal(run.status, "FAILED");

  const classifications = classificationsOf(run);
  assert.ok(classifications.includes("WITHDRAWAL_RESERVATION_MISSING"), classifications.join(","));
  assert.ok(
    classifications.includes("PAYOUT_SUCCESS_WITHOUT_RESERVATION"),
    classifications.join(",")
  );

  const missing = await findIssue("WITHDRAWAL_RESERVATION_MISSING", withdrawal.id);
  assert.equal(missing.severity, "CRITICAL");
  const stranded = await findIssue("PAYOUT_SUCCESS_WITHOUT_RESERVATION", payout.id);
  assert.equal(stranded.details.withdrawalStatus, "PENDING");
});

test("the database refuses a payout marked SUCCESS without settlement", async () => {
  const withdrawal = await prisma.withdrawal.create({
    data: {
      userId: users.customer.id,
      walletId: wallets.customer.id,
      amount: "6.00",
      currency: "ETB",
      status: "PROCESSING",
      idempotencyKey: `verify-settled-${runId}`,
    },
  });
  injected.withdrawalIds.push(withdrawal.id);

  await assert.rejects(
    prisma.$transaction((tx) =>
      tx.payout.create({
        data: {
          userId: users.customer.id,
          walletId: wallets.customer.id,
          withdrawalId: withdrawal.id,
          destinationAccount: `verify-settle-${runId}`,
          amount: "6.00",
          currency: "ETB",
          status: "SUCCESS",
          provider: "MOCK",
          idempotencyKey: `verify-settled-payout-${runId}`,
          requestedAt: new Date(Date.now() - 120_000),
          sentAt: new Date(Date.now() - 60_000),
          completedAt: new Date(),
        },
      })
    ),
    /settlement journal entry/
  );

  // Nothing half-written may survive the rejected attempt.
  assert.equal(await prisma.payout.count({ where: { withdrawalId: withdrawal.id } }), 0);
});

test("suppression stays with ADMIN and keeps the finding out of the backlog", async () => {
  const issue = await findIssue("WITHDRAWAL_RESERVATION_MISSING", injected.withdrawalIds[0]);

  const forbidden = await request(app)
    .post(`${BASE}/verification/issues/${issue.id}/suppress`)
    .set("Authorization", auth("finance"));
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.code, "FORBIDDEN_ROLE");

  const before = (await request(app).get(`${BASE}/integrity`).set("Authorization", auth("admin")))
    .body.data.openIssues;

  const suppressed = await request(app)
    .post(`${BASE}/verification/issues/${issue.id}/suppress`)
    .set("Authorization", auth("admin"))
    .send({ note: "Fixture row kept for the payout tests in this suite" });
  assert.equal(suppressed.status, 200);
  assert.equal(suppressed.body.data.issue.status, "SUPPRESSED");

  const after = (await request(app).get(`${BASE}/integrity`).set("Authorization", auth("admin")))
    .body.data.openIssues;
  assert.equal(after.CRITICAL, before.CRITICAL - 1, "suppression clears the actionable backlog");

  const run = (await postRun()).body.data.run;
  assert.equal(run.status, "FAILED", "suppression does not declare the books healthy");
  assert.equal(
    await prisma.ledgerVerificationIssue.count({
      where: {
        classification: "WITHDRAWAL_RESERVATION_MISSING",
        aggregateId: issue.aggregateId,
      },
    }),
    1,
    "a suppressed finding is not re-inserted"
  );
});

test("reopening returns a suppressed finding to the backlog", async () => {
  const issue = await findIssue("WITHDRAWAL_RESERVATION_MISSING", injected.withdrawalIds[0]);

  const forbidden = await request(app)
    .post(`${BASE}/verification/issues/${issue.id}/reopen`)
    .set("Authorization", auth("finance"));
  assert.equal(forbidden.status, 403);

  const reopened = await request(app)
    .post(`${BASE}/verification/issues/${issue.id}/reopen`)
    .set("Authorization", auth("admin"))
    .send({ note: "Fixture finished, the check must be visible again" });
  assert.equal(reopened.status, 200);
  assert.equal(reopened.body.data.issue.status, "OPEN");

  const listed = await request(app)
    .get(`${BASE}/verification/issues?status=OPEN`)
    .set("Authorization", auth("finance"));
  assert.equal(listed.status, 200);
  assert.ok(
    listed.body.data.issues.some((row) => row.id === issue.id),
    "an reopened issue is back in the open list"
  );

  const all = await request(app)
    .get(`${BASE}/verification/issues?status=all&limit=100`)
    .set("Authorization", auth("admin"));
  assert.equal(all.status, 200);
  assert.ok(all.body.data.issues.length >= 2);
  assert.ok(all.body.data.issues.every((row) => row.runReference));
});

test("the scheduled job runs one cycle at a time", async () => {
  const first = ledgerJob.runCycle();
  const second = ledgerJob.runCycle();
  const results = await Promise.all([first, second]);

  assert.ok(results[0], "one cycle must complete");
  assert.equal(results[1], null, "an overlapping cycle is skipped, not queued");
  assert.equal(results[0].trigger, "SCHEDULED");
  assert.equal(ledgerJob.isRunning(), false);

  ledgerJob.stopLedgerVerificationJob();
  assert.equal(
    ledgerJob.startLedgerVerificationJob(),
    null,
    "disabled outside production defaults"
  );
});

test("verification and issue counts are exported as metrics", async () => {
  const rendered = metrics.render();
  assert.match(rendered, /banking_ledger_verification_runs_total/);
  assert.match(
    rendered,
    /banking_ledger_open_issues\{service="user-service",severity="CRITICAL"\}/
  );
  assert.match(rendered, /banking_ledger_verification_last_run_timestamp_seconds/);

  const counts = await ledgerVerify.openIssueCounts();
  assert.equal(typeof counts.CRITICAL, "number");
  assert.ok(counts.CRITICAL >= 1);
});

test("abandoned runs are closed instead of hanging in RUNNING", async () => {
  const stale = await prisma.ledgerVerificationRun.create({
    data: {
      trigger: "SCHEDULED",
      status: "RUNNING",
      businessDate: new Date(),
      startedAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
    },
  });

  const closed = await ledgerVerify.reapAbandonedRuns();
  assert.ok(closed >= 1);

  const row = await prisma.ledgerVerificationRun.findUnique({ where: { id: stale.id } });
  assert.equal(row.status, "ERROR");
  assert.ok(row.finishedAt);
  assert.match(row.errorMessage, /abandoned/i);
});
