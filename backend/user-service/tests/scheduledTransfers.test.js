const testDatabaseUrl = process.env.WALLET_TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("WALLET_TEST_DATABASE_URL must point to an isolated test database");
}
const testDatabaseName = new URL(testDatabaseUrl).pathname.split("/").pop().split("?")[0];
if (!/_test$/i.test(testDatabaseName)) {
  throw new Error("Scheduled transfer tests only run against a database whose name ends in _test");
}

process.env.DATABASE_URL = testDatabaseUrl;
process.env.NODE_ENV = "test";
process.env.AUTH_MODE = "dev";
process.env.DEV_API_KEY = "";
process.env.AUTH_RATE_LIMIT_MAX = "1000";
process.env.RATE_LIMIT_MAX = "10000";
process.env.OUTBOX_ENABLED = "true";

const { createHash, randomBytes, randomUUID } = require("node:crypto");
const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("../src/app");
const prisma = require("../src/config/database");
const kycEligibility = require("../src/services/kycEligibility");
const ledger = require("../src/modules/ledger/ledger.service");
const scheduled = require("../src/modules/scheduledTransfers/scheduledTransfers.service");

const users = {};
const tokens = {};
const wallets = {};

const createUserAndSession = async (label, role = "USER") => {
  const suffix = randomUUID().replace(/-/g, "");
  const user = await prisma.userProfile.create({
    data: {
      firstName: label,
      lastName: "Schedule Test",
      username: `${label}_${suffix.slice(0, 12)}`,
      email: `${label}_${suffix}@schedule.test`,
      phoneNumber: "+15550188",
      dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
      gender: "other",
      passwordHash: "schedule-test-only",
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
  const wallet = await prisma.wallet.create({ data: { userId: user.id } });
  users[label] = user;
  tokens[label] = token;
  wallets[label] = wallet;
};

const auth = (label) => `Bearer ${tokens[label]}`;

const fundWallet = async (walletId, amount) =>
  prisma.$transaction((tx) =>
    ledger.postEntry({
      tx,
      eventType: "TEST_FUNDING",
      eventRef: `test-schedule-funding:${randomUUID()}`,
      currency: "ETB",
      postings: [
        { accountCode: ledger.ACCOUNT_CODES.OPENING_BALANCE, direction: "DEBIT", amount },
        { accountCode: `WALLET:${walletId}`, direction: "CREDIT", amount },
      ],
    })
  );

const balanceOf = async (label) =>
  (await prisma.wallet.findUnique({ where: { id: wallets[label].id } })).balance.toFixed(2);

const createSchedule = (label, body = {}) =>
  request(app)
    .post("/api/v1/scheduled-transfers")
    .set("Authorization", auth(label))
    .send({
      destinationWalletId: wallets.recipient.id,
      amount: "10.00",
      frequency: "ONCE",
      firstRunAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      ...body,
    });

// The worker only picks up ACTIVE rows whose run time has passed, so tests
// rewind the planned run instead of waiting for it.
const markDue = (scheduleId, runAt = new Date(Date.now() - 60 * 1000)) =>
  prisma.scheduledTransfer.update({
    where: { id: scheduleId },
    data: { status: "ACTIVE", nextRunAt: runAt, failureReason: null },
  });

const outboxEvents = (scheduleId, type) =>
  prisma.outboxEvent.findMany({
    where: { aggregateId: scheduleId, type },
    orderBy: { createdAt: "asc" },
  });

before(async () => {
  kycEligibility.setKycClient({
    async getUserKycStatus() {
      return { status: "APPROVED", isApproved: true };
    },
  });
  await prisma.$connect();
  await createUserAndSession("sender");
  await createUserAndSession("recipient");
  await createUserAndSession("poor");
  await fundWallet(wallets.sender.id, "500.00");
});

after(async () => {
  kycEligibility.setKycClient(null);
  await prisma.scheduledTransfer
    .deleteMany({
      where: { userId: { in: [users.sender.id, users.recipient.id, users.poor.id] } },
    })
    .catch(() => {});
  await prisma.$disconnect();
});

test("schedule planning is derived from the frequency", () => {
  assert.equal(
    scheduled.nextRunAfter(new Date("2026-03-05T10:00:00Z"), "DAILY").toISOString(),
    "2026-03-06T10:00:00.000Z"
  );
  assert.equal(
    scheduled.nextRunAfter(new Date("2026-03-05T10:00:00Z"), "WEEKLY").toISOString(),
    "2026-03-12T10:00:00.000Z"
  );
  assert.equal(
    scheduled.nextRunAfter(new Date("2026-01-31T10:00:00Z"), "MONTHLY").toISOString(),
    "2026-02-28T10:00:00.000Z"
  );
  assert.equal(
    scheduled.nextRunAfter(new Date("2028-01-31T10:00:00Z"), "MONTHLY").toISOString(),
    "2028-02-29T10:00:00.000Z"
  );
});

test("creating a schedule requires an approved customer", async () => {
  kycEligibility.setKycClient({
    async getUserKycStatus() {
      return { status: "PENDING", isApproved: false };
    },
  });

  const blocked = await createSchedule("sender");
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, "KYC_NOT_APPROVED");

  kycEligibility.setKycClient({
    async getUserKycStatus() {
      return { status: "APPROVED", isApproved: true };
    },
  });
});

test("schedules are validated before they are stored", async () => {
  const past = await createSchedule("sender", {
    firstRunAt: new Date(Date.now() - 60 * 1000).toISOString(),
  });
  assert.equal(past.status, 400);
  assert.match(past.body.errors.firstRunAt, /future/);

  const frequency = await createSchedule("sender", { frequency: "HOURLY" });
  assert.equal(frequency.status, 400);
  assert.ok(frequency.body.errors.frequency);

  const precision = await createSchedule("sender", { amount: "10.005" });
  assert.equal(precision.status, 400);
  assert.ok(precision.body.errors.amount);
});

test("destination wallets must exist and belong to someone else", async () => {
  const missing = await createSchedule("sender", { destinationWalletId: randomUUID() });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, "WALLET_NOT_FOUND");

  const self = await createSchedule("sender", { destinationWalletId: wallets.sender.id });
  assert.equal(self.status, 400);
  assert.equal(self.body.code, "SELF_TRANSFER");
});

test("a created schedule is active and stores the planned run", async () => {
  const runAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  const created = await createSchedule("sender", { frequency: "MONTHLY", firstRunAt: runAt });
  assert.equal(created.status, 201);

  const schedule = created.body.data.schedule;
  assert.equal(schedule.status, "ACTIVE");
  assert.equal(schedule.frequency, "MONTHLY");
  assert.equal(schedule.currency, "ETB");
  assert.equal(schedule.amount, "10.00");
  assert.equal(schedule.timezone, "Africa/Addis_Ababa");
  assert.equal(new Date(schedule.nextRunAt).toISOString(), runAt);

  const fetched = await request(app)
    .get(`/api/v1/scheduled-transfers/${schedule.id}`)
    .set("Authorization", auth("sender"));
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.data.schedule.id, schedule.id);

  const other = await request(app)
    .get(`/api/v1/scheduled-transfers/${schedule.id}`)
    .set("Authorization", auth("recipient"));
  assert.equal(other.status, 404);
  assert.equal(other.body.code, "SCHEDULE_NOT_FOUND");
});

test("pause, resume and cancel follow the allowed transitions", async () => {
  const created = await createSchedule("sender");
  const id = created.body.data.schedule.id;

  const pause = async () =>
    request(app)
      .post(`/api/v1/scheduled-transfers/${id}/pause`)
      .set("Authorization", auth("sender"));
  const resume = async () =>
    request(app)
      .post(`/api/v1/scheduled-transfers/${id}/resume`)
      .set("Authorization", auth("sender"));
  const cancel = async () =>
    request(app)
      .post(`/api/v1/scheduled-transfers/${id}/cancel`)
      .set("Authorization", auth("sender"));

  const firstPause = await pause();
  assert.equal(firstPause.status, 200);
  assert.equal(firstPause.body.data.schedule.status, "PAUSED");

  const doublePause = await pause();
  assert.equal(doublePause.status, 409);
  assert.equal(doublePause.body.code, "INVALID_SCHEDULE_TRANSITION");

  const resumed = await resume();
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.data.schedule.status, "ACTIVE");
  assert.ok(new Date(resumed.body.data.schedule.nextRunAt) > new Date());

  const cancelled = await cancel();
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.data.schedule.status, "CANCELLED");

  const revive = await resume();
  assert.equal(revive.status, 409);
});

test("a due one-off schedule transfers once and completes", async () => {
  const created = await createSchedule("sender", { amount: "25.00" });
  const id = created.body.data.schedule.id;
  const runAt = new Date(Date.now() - 60 * 1000);
  await markDue(id, runAt);

  const before = { sender: await balanceOf("sender"), recipient: await balanceOf("recipient") };
  const result = await scheduled.executeDueSchedules({ now: new Date() });
  assert.ok(result.processed >= 1);

  const stored = await prisma.scheduledTransfer.findUnique({ where: { id } });
  assert.equal(stored.status, "COMPLETED");
  assert.equal(stored.nextRunAt.toISOString(), runAt.toISOString());
  assert.equal(stored.lastRunAt.toISOString(), runAt.toISOString());
  assert.ok(stored.lastTransactionId);

  assert.equal(await balanceOf("sender"), (parseFloat(before.sender) - 25).toFixed(2));
  assert.equal(await balanceOf("recipient"), (parseFloat(before.recipient) + 25).toFixed(2));

  const transaction = await prisma.transaction.findUnique({
    where: { id: stored.lastTransactionId },
  });
  assert.equal(transaction.idempotencyKey, `sched:${id}:${runAt.toISOString()}`);

  await scheduled.executeDueSchedules({ now: new Date() });
  const retried = await prisma.scheduledTransfer.findUnique({ where: { id } });
  const stillDue = await prisma.scheduledTransfer.count({
    where: { userId: users.sender.id, status: "ACTIVE", nextRunAt: { lte: new Date() } },
  });
  assert.equal(stillDue, 0);
  assert.equal(retried.lastTransactionId, stored.lastTransactionId);
  assert.equal(await balanceOf("sender"), (parseFloat(before.sender) - 25).toFixed(2));
});

test("a recurring schedule advances to the next run and transfers again", async () => {
  const created = await createSchedule("sender", { frequency: "WEEKLY", amount: "5.00" });
  const id = created.body.data.schedule.id;
  const firstRun = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  await markDue(id, firstRun);

  await scheduled.executeDueSchedules({ now: new Date() });
  const afterFirst = await prisma.scheduledTransfer.findUnique({ where: { id } });
  assert.equal(afterFirst.status, "ACTIVE");
  assert.equal(
    afterFirst.nextRunAt.toISOString(),
    new Date(firstRun.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
  );

  await scheduled.executeDueSchedules({
    now: new Date(afterFirst.nextRunAt.getTime() + 60 * 1000),
  });
  const afterSecond = await prisma.scheduledTransfer.findUnique({ where: { id } });
  assert.equal(afterSecond.status, "ACTIVE");
  assert.notEqual(afterSecond.lastTransactionId, afterFirst.lastTransactionId);

  const transactions = await prisma.transaction.findMany({
    where: { idempotencyKey: { startsWith: `sched:${id}:` } },
  });
  assert.equal(transactions.length, 2);

  await request(app)
    .post(`/api/v1/scheduled-transfers/${id}/cancel`)
    .set("Authorization", auth("sender"));
});

test("an unfunded schedule pauses and publishes a failure event", async () => {
  const created = await createSchedule("poor", { amount: "400.00" });
  const id = created.body.data.schedule.id;
  await markDue(id);

  const senderBalance = await balanceOf("poor");
  await scheduled.executeDueSchedules({ now: new Date() });

  const stored = await prisma.scheduledTransfer.findUnique({ where: { id } });
  assert.equal(stored.status, "PAUSED");
  assert.match(stored.failureReason, /balance|insufficient/i);
  assert.equal(await balanceOf("poor"), senderBalance);

  const events = await outboxEvents(id, "scheduled_transfer.failed");
  assert.equal(events.length, 1);
  assert.equal(events[0].aggregateType, "ScheduledTransfer");
  assert.equal(events[0].payload.email, users.poor.email);
  assert.equal(events[0].payload.amount, "400.00");
  assert.equal(events[0].publishedAt, null);

  await request(app)
    .post(`/api/v1/scheduled-transfers/${id}/cancel`)
    .set("Authorization", auth("poor"));
});

test("schedules can be filtered and paged by the owner", async () => {
  const ids = [];
  for (const amount of ["2.00", "3.00"]) {
    const created = await createSchedule("sender", { amount });
    const id = created.body.data.schedule.id;
    ids.push(id);
    await request(app)
      .post(`/api/v1/scheduled-transfers/${id}/pause`)
      .set("Authorization", auth("sender"));
  }

  const mine = await request(app)
    .get("/api/v1/scheduled-transfers?status=PAUSED&limit=1")
    .set("Authorization", auth("sender"));
  assert.equal(mine.status, 200);
  assert.equal(mine.body.data.schedules.length, 1);
  assert.equal(mine.body.data.page.hasMore, true);

  const next = await request(app)
    .get(
      `/api/v1/scheduled-transfers?status=PAUSED&limit=1&cursor=${mine.body.data.page.nextCursor}`
    )
    .set("Authorization", auth("sender"));
  assert.equal(next.status, 200);
  assert.notEqual(next.body.data.schedules[0].id, mine.body.data.schedules[0].id);
  assert.deepEqual(
    [mine.body.data.schedules[0].id, next.body.data.schedules[0].id].sort(),
    ids.slice().sort()
  );

  const badStatus = await request(app)
    .get("/api/v1/scheduled-transfers?status=RUNNING")
    .set("Authorization", auth("sender"));
  assert.equal(badStatus.status, 400);

  const foreignCursor = await request(app)
    .get(`/api/v1/scheduled-transfers?cursor=${randomUUID()}`)
    .set("Authorization", auth("sender"));
  assert.equal(foreignCursor.status, 400);
  assert.equal(foreignCursor.body.code, "INVALID_SCHEDULE_CURSOR");

  const anonymous = await request(app).get("/api/v1/scheduled-transfers");
  assert.equal(anonymous.status, 401);

  for (const id of ids) {
    await request(app)
      .post(`/api/v1/scheduled-transfers/${id}/cancel`)
      .set("Authorization", auth("sender"));
  }
});
