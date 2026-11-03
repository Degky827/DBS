const testDatabaseUrl = process.env.WALLET_TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("WALLET_TEST_DATABASE_URL must point to an isolated test database");
}
const testDatabaseName = new URL(testDatabaseUrl).pathname.split("/").pop().split("?")[0];
if (!/_test$/i.test(testDatabaseName)) {
  throw new Error("Tier limit tests only run against a database whose name ends in _test");
}

process.env.DATABASE_URL = testDatabaseUrl;
process.env.NODE_ENV = "test";
process.env.AUTH_MODE = "dev";
process.env.DEV_API_KEY = "";
process.env.ENABLE_API_DOCS = "true";
process.env.AUTH_RATE_LIMIT_MAX = "1000";
process.env.RATE_LIMIT_MAX = "10000";

const { createHash, randomBytes, randomUUID } = require("node:crypto");
const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("../src/app");
const prisma = require("../src/config/database");
const kycEligibility = require("../src/services/kycEligibility");
const PaymentsService = require("../src/modules/payments/payments.service");
const { setCustomPaymentsService } = require("../src/modules/payments/payments.routes");
const ledger = require("../src/modules/ledger/ledger.service");
const policies = require("../src/modules/policies/policies.service");
const tierLimits = require("../src/modules/policies/tierLimits.service");
const scheduled = require("../src/modules/scheduledTransfers/scheduledTransfers.service");

const users = {};
const tokens = {};
const wallets = {};
const actors = [];
const originalPolicies = new Map();

// Tier values shaped exactly like the payload kyc-service serves from
// GET /internal/users/:userId/status, which is what kycClient hands to the
// money paths: decimals as strings, counts as integers.
const limitRow = (operation, values = {}) => ({
  operation,
  currency: "ETB",
  isAllowed: true,
  minAmount: null,
  maxAmount: null,
  dailyAmount: null,
  dailyCount: null,
  monthlyAmount: null,
  maxBalance: null,
  ...values,
});

const tier = (limits, options = {}) => ({
  id: randomUUID(),
  code: options.code || "TIER_TEST",
  version: options.version === undefined ? 1 : options.version,
  source: options.source || "ASSIGNMENT",
  allowedOperations:
    options.allowed === undefined ? limits.map((limit) => limit.operation) : options.allowed,
  limits,
});

// The status the KYC gate resolves for the authenticated subject; a tier is
// handed to the financial handler on req.kyc, and approved(null) is an approved
// customer whose verification level the KYC service does not configure.
const approved = (tierValue) =>
  kycEligibility.setKycClient({
    async getUserKycStatus() {
      return {
        status: "APPROVED",
        isApproved: true,
        tier: tierValue === undefined ? null : tierValue,
      };
    },
  });

const createUser = async (label, funding = null) => {
  const suffix = randomUUID().replace(/-/g, "");
  const user = await prisma.userProfile.create({
    data: {
      firstName: label,
      lastName: "Tier Test",
      username: `${label}_${suffix.slice(0, 12)}`,
      email: `${label}_${suffix}@tier.test`,
      phoneNumber: "+15550199",
      dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
      gender: "other",
      passwordHash: "tier-test-only",
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
  wallets[label] = await prisma.wallet.create({ data: { userId: user.id } });
  if (funding) {
    // Money enters through a balanced ledger entry, as it does in production.
    await prisma.$transaction((tx) =>
      ledger.postEntry({
        tx,
        eventType: "TEST_FUNDING",
        eventRef: `test-funding:${randomUUID()}`,
        currency: "ETB",
        description: "Test funding from opening equity",
        postings: [
          {
            accountCode: ledger.ACCOUNT_CODES.OPENING_BALANCE,
            direction: "DEBIT",
            amount: funding,
          },
          { accountCode: `WALLET:${wallets[label].id}`, direction: "CREDIT", amount: funding },
        ],
      })
    );
  }
  if (label !== "recipient") actors.push(label);
  return label;
};

// Each scenario gets its own customer: tier usage is per subject and per
// business date, so a shared fixture would let one test spend another's ceiling.
const actor = async (name, funding = "10000.00") => {
  const label = `${name}_${randomUUID().slice(0, 8)}`;
  return createUser(label, funding);
};

const transfer = (label, amount) =>
  request(app)
    .post("/api/v1/transactions/transfers")
    .set("Authorization", `Bearer ${tokens[label]}`)
    .set("Idempotency-Key", `tr_${randomUUID().replace(/-/g, "")}`)
    .send({ destinationWalletId: wallets.recipient.id, amount });

const withdraw = (label, amount) =>
  request(app)
    .post("/api/v1/payments/withdrawals")
    .set("Authorization", `Bearer ${tokens[label]}`)
    .set("Idempotency-Key", `wd_${randomUUID().replace(/-/g, "")}`)
    .send({ amount });

const deposit = (label, amount) =>
  request(app)
    .post("/api/v1/payments/deposits")
    .set("Authorization", `Bearer ${tokens[label]}`)
    .set("Idempotency-Key", `dp_${randomUUID().replace(/-/g, "")}`)
    .send({ amount });

const createSchedule = (label, body = {}) =>
  request(app)
    .post("/api/v1/scheduled-transfers")
    .set("Authorization", `Bearer ${tokens[label]}`)
    .send({
      destinationWalletId: wallets.recipient.id,
      amount: "10.00",
      frequency: "ONCE",
      firstRunAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      ...body,
    });

const transfersBy = (label) =>
  prisma.transaction.findMany({
    where: { initiatedByUserId: users[label].id, type: "TRANSFER" },
    orderBy: { createdAt: "asc" },
    select: { id: true, amount: true, businessDate: true, policySnapshot: true },
  });

const transferPolicyRow = () =>
  prisma.financialPolicy.findUnique({
    where: { type_currency: { type: "TRANSFER", currency: "ETB" } },
  });

// The tier clamp is layered on platform policy, so every scenario widens the
// product ceilings first: a refusal then proves the tier, not the default
// policy, is what stopped the operation.
const widenPolicy = async (type) => {
  const policy = await prisma.financialPolicy.findUnique({
    where: { type_currency: { type, currency: "ETB" } },
  });
  if (!policy) throw new Error(`No platform policy seeded for ${type}`);
  if (!originalPolicies.has(type)) originalPolicies.set(type, policy);
  return prisma.financialPolicy.update({
    where: { id: policy.id },
    data: {
      minAmount: "1.00",
      maxAmount: "900000.00",
      dailyOutgoingAmount: "900000.00",
      dailyOutgoingCount: 1000,
      feeType: "NONE",
      feeFlat: "0.00",
      feeBps: 0,
      feeMin: "0.00",
      feeMax: null,
    },
  });
};

const mockProvider = () => ({
  async initiate(params) {
    return {
      checkoutUrl: `https://checkout.chapa.test/session/${params.txRef}`,
      txRef: params.txRef,
      merchantReference: params.txRef,
      providerRef: `CHAPA-${params.txRef}`,
    };
  },
  async getStatus(reference) {
    return {
      status: "PENDING",
      rawStatus: "PENDING",
      merchantReference: reference,
      providerRef: `CHAPA-${reference}`,
      amount: "20.00",
      currency: "ETB",
    };
  },
  verifyWebhook: () => true,
});

before(async () => {
  await prisma.$connect();
  setCustomPaymentsService(new PaymentsService(mockProvider(), prisma));
  await createUser("recipient", null);
  for (const type of ["TRANSFER", "DEPOSIT", "WITHDRAWAL"]) {
    await widenPolicy(type);
  }
  approved(null);
});

after(async () => {
  kycEligibility.setKycClient(null);
  setCustomPaymentsService(null);
  const userIds = [...actors, "recipient"].map((label) => users[label]?.id).filter(Boolean);
  try {
    for (const [, policy] of originalPolicies) {
      await prisma.financialPolicy.update({
        where: { id: policy.id },
        data: {
          minAmount: policy.minAmount,
          maxAmount: policy.maxAmount,
          dailyOutgoingAmount: policy.dailyOutgoingAmount,
          dailyOutgoingCount: policy.dailyOutgoingCount,
          feeType: policy.feeType,
          feeFlat: policy.feeFlat,
          feeBps: policy.feeBps,
          feeMin: policy.feeMin,
          feeMax: policy.feeMax,
        },
      });
    }
    // Posted transfers and settled deposits are immutable ledger records and
    // deliberately stay in the disposable test database; only rows no money
    // has moved on are removed.
    await prisma.scheduledTransfer.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.payment.deleteMany({
      where: { userId: { in: userIds }, status: "PENDING", transaction: null },
    });
    await prisma.devSession.deleteMany({ where: { userId: { in: userIds } } });
  } finally {
    await prisma.$disconnect();
  }
});

test("a transfer above the tier maximum is refused before the ledger moves", async () => {
  const sender = await actor("max", "30000.00");
  approved(tier([limitRow("TRANSFER", { maxAmount: "25000.00" })], { code: "TIER_1" }));

  const over = await transfer(sender, "25000.01");
  assert.equal(over.status, 409);
  assert.equal(over.body.code, "TIER_AMOUNT_LIMIT_EXCEEDED");
  assert.equal(over.body.errors.tierCode, "TIER_1");
  assert.equal(over.body.errors.tierSource, "ASSIGNMENT");
  assert.equal(over.body.errors.limit, "25000.00");

  const at = await transfer(sender, "25000.00");
  assert.equal(at.status, 201);

  assert.equal(
    await prisma.transaction.count({
      where: { initiatedByUserId: users[sender].id, amount: "25000.01" },
    }),
    0
  );
});

test("a tier minimum refuses with the amount code, not a validation error", async () => {
  const sender = await actor("min");
  approved(tier([limitRow("TRANSFER", { minAmount: "500.00", maxAmount: "25000.00" })]));

  const below = await transfer(sender, "499.99");
  assert.equal(below.status, 409);
  assert.equal(below.body.code, "TIER_AMOUNT_LIMIT_EXCEEDED");
  assert.equal(below.body.errors.minimum, "500.00");
  assert.equal((await transfersBy(sender)).length, 0);
});

test("the tier daily amount and count are spent by the transfers that fit", async () => {
  const sender = await actor("daily", "30000.00");
  approved(
    tier([
      limitRow("TRANSFER", {
        maxAmount: "1000.00",
        dailyAmount: "1500.00",
        dailyCount: 2,
        monthlyAmount: "90000.00",
      }),
    ])
  );

  const first = await transfer(sender, "1000.00");
  assert.equal(first.status, 201);

  const overDailyAmount = await transfer(sender, "600.00");
  assert.equal(overDailyAmount.status, 409);
  assert.equal(overDailyAmount.body.code, "TIER_DAILY_LIMIT_EXCEEDED");
  assert.equal(overDailyAmount.body.errors.used, "1000.00");
  assert.equal(overDailyAmount.body.errors.limit, "1500.00");

  const second = await transfer(sender, "400.00");
  assert.equal(second.status, 201);

  const overCount = await transfer(sender, "100.00");
  assert.equal(overCount.status, 409);
  assert.equal(overCount.body.code, "TIER_DAILY_COUNT_EXCEEDED");
  assert.equal(overCount.body.errors.limit, 2);
  assert.equal(overCount.body.errors.used, 2);

  assert.deepEqual(
    (await transfersBy(sender)).map((row) => row.amount.toFixed(2)),
    ["1000.00", "400.00"]
  );
});

test("a deposit that fits the day but breaches the month is refused", async () => {
  const depositor = await actor("month", null);
  const today = policies.businessDateFor((await transferPolicyRow()).timezone);

  // A deposit still awaiting the provider is already authorized, so the month
  // counts it. Posted ledger rows cannot be rewound (the database forbids it),
  // which is why the earlier day is a pending payment and not a transfer.
  await prisma.payment.create({
    data: {
      userId: users[depositor].id,
      walletId: wallets[depositor].id,
      provider: "CHAPA",
      type: "DEPOSIT",
      status: "PENDING",
      amount: "4000.00",
      currency: "ETB",
      businessDate: new Date(`${today.slice(0, 7)}-01T00:00:00.000Z`),
      idempotencyKey: `seed_month_${randomUUID().replace(/-/g, "")}`,
    },
  });

  approved(tier([limitRow("DEPOSIT", { maxAmount: "10000.00", monthlyAmount: "4500.00" })]));

  const response = await deposit(depositor, "600.00");
  assert.equal(response.status, 409);
  assert.equal(response.body.code, "TIER_MONTHLY_LIMIT_EXCEEDED");
  assert.equal(response.body.errors.limit, "4500.00");
  assert.equal(response.body.errors.used, "4000.00");
  assert.equal(response.body.errors.month, today.slice(0, 7));

  const fits = await deposit(depositor, "500.00");
  assert.equal(fits.status, 201);

  assert.equal(await prisma.payment.count({ where: { userId: users[depositor].id } }), 2);
});

test("an operation the tier does not allow is a 403, never an unlimited amount", async () => {
  const sender = await actor("deny");
  approved(
    tier([
      limitRow("TRANSFER", { maxAmount: "25000.00" }),
      limitRow("WITHDRAWAL", { isAllowed: false }),
    ])
  );

  const withdrawal = await withdraw(sender, "100.00");
  assert.equal(withdrawal.status, 403);
  assert.equal(withdrawal.body.code, "TIER_OPERATION_NOT_ALLOWED");
  assert.equal(withdrawal.body.errors.operation, "WITHDRAWAL");
  assert.equal(withdrawal.body.errors.tierCode, "TIER_TEST");
  assert.equal(await prisma.withdrawal.count({ where: { userId: users[sender].id } }), 0);

  // A tier with no row for the operation denies it too, instead of reading the
  // missing row as "no ceiling".
  const schedule = await createSchedule(sender, { amount: "50.00" });
  assert.equal(schedule.status, 403);
  assert.equal(schedule.body.code, "TIER_OPERATION_NOT_ALLOWED");
  assert.equal(schedule.body.errors.operation, "SCHEDULED_TRANSFER");
  assert.equal(await prisma.scheduledTransfer.count({ where: { userId: users[sender].id } }), 0);

  // Limits written in another currency do not authorize ETB.
  approved(tier([limitRow("TRANSFER", { currency: "USD", maxAmount: "25000.00" })]));
  const mismatched = await transfer(sender, "100.00");
  assert.equal(mismatched.status, 403);
  assert.equal(mismatched.body.code, "TIER_OPERATION_NOT_ALLOWED");
  assert.equal(mismatched.body.errors.currency, "ETB");

  // allowedOperations is the second half of the contract: a limits row without
  // it is still a denial.
  approved(tier([limitRow("TRANSFER", { maxAmount: "25000.00" })], { allowed: [] }));
  const notListed = await transfer(sender, "100.00");
  assert.equal(notListed.status, 403);
  assert.equal(notListed.body.code, "TIER_OPERATION_NOT_ALLOWED");
});

test("the tier maximum balance clamps a deposit over balance plus pending credits", async () => {
  const depositor = await actor("balance", "50000.00");
  approved(
    tier([
      limitRow("TRANSFER", { maxAmount: "25000.00" }),
      limitRow("DEPOSIT", { maxAmount: "10000.00", maxBalance: "60000.00" }),
    ])
  );

  // 50000 in the wallet, 9999 still pending at the provider, so the ceiling
  // leaves exactly 1.00 of headroom.
  const pending = await deposit(depositor, "9999.00");
  assert.equal(pending.status, 201);

  const over = await deposit(depositor, "100.01");
  assert.equal(over.status, 409);
  assert.equal(over.body.code, "TIER_MAX_BALANCE_EXCEEDED");
  assert.equal(over.body.errors.limit, "60000.00");
  assert.equal(over.body.errors.balance, "59999.00");

  const fits = await deposit(depositor, "1.00");
  assert.equal(fits.status, 201);

  // The per-transaction ceiling is checked before the balance projection.
  const tooBig = await deposit(depositor, "10000.01");
  assert.equal(tooBig.status, 409);
  assert.equal(tooBig.body.code, "TIER_AMOUNT_LIMIT_EXCEEDED");

  assert.equal(
    await prisma.payment.count({
      where: { userId: users[depositor].id, status: "PENDING" },
    }),
    2
  );
});

test("with no tier configured only platform policy decides, and the record says so", async () => {
  const sender = await actor("nopolicy", "5000.00");
  approved(null);
  const policy = await transferPolicyRow();
  await prisma.financialPolicy.update({
    where: { id: policy.id },
    data: { maxAmount: "750.00", dailyOutgoingCount: 1000, dailyOutgoingAmount: "900000.00" },
  });
  try {
    const overPlatform = await transfer(sender, "751.00");
    assert.equal(overPlatform.status, 400);
    assert.equal(overPlatform.body.code, "VALIDATION_ERROR");

    const ok = await transfer(sender, "700.00");
    assert.equal(ok.status, 201);
    const rows = await transfersBy(sender);
    const snapshot = rows.at(-1).policySnapshot.kycTier;
    assert.equal(snapshot.enforced, false);
    assert.equal(snapshot.reason, "TIER_NOT_CONFIGURED");
  } finally {
    await prisma.financialPolicy.update({
      where: { id: policy.id },
      data: { maxAmount: originalPolicies.get("TRANSFER").maxAmount },
    });
  }
});

test("an enforced tier is stored on the transfer and a skipped clamp is stored too", async () => {
  const sender = await actor("snapshot", "30000.00");
  approved(
    tier(
      [
        limitRow("TRANSFER", {
          minAmount: "1.00",
          maxAmount: "25000.00",
          dailyAmount: "50000.00",
          dailyCount: 20,
          monthlyAmount: "200000.00",
        }),
      ],
      { code: "TIER_2", version: 3 }
    )
  );

  const response = await transfer(sender, "1000.00");
  assert.equal(response.status, 201);
  const rows = await transfersBy(sender);
  const snapshot = rows.at(-1).policySnapshot.kycTier;
  assert.equal(snapshot.enforced, true);
  assert.equal(snapshot.tierCode, "TIER_2");
  assert.equal(snapshot.tierVersion, 3);
  assert.equal(snapshot.tierSource, "ASSIGNMENT");
  assert.equal(snapshot.operation, "TRANSFER");
  assert.equal(snapshot.currency, "ETB");
  assert.equal(snapshot.maxAmount, "25000.00");
  assert.equal(snapshot.dailyCount, 20);
  assert.equal(snapshot.monthlyAmount, "200000.00");
  assert.equal(snapshot.maxBalance, null);
  assert.match(snapshot.dailyUsedBefore, /^\d+\.\d{2}$/);
  assert.ok(Number.isInteger(snapshot.dailyCountBefore));
  assert.match(snapshot.monthlyUsedBefore, /^\d+\.\d{2}$/);

  // The worker that runs due schedules has no KYC session, so the transfer it
  // posts records the skipped clamp instead of pretending it was checked.
  approved(
    tier([
      limitRow("TRANSFER", { maxAmount: "25000.00" }),
      limitRow("SCHEDULED_TRANSFER", { maxAmount: "5000.00" }),
    ])
  );
  const created = await createSchedule(sender, { amount: "10.00" });
  assert.equal(created.status, 201);
  await prisma.scheduledTransfer.update({
    where: { id: created.body.data.schedule.id },
    data: { nextRunAt: new Date(Date.now() - 60 * 1000) },
  });
  assert.ok((await scheduled.executeDueSchedules({})).processed >= 1);

  const run = await prisma.transaction.findFirst({
    where: {
      initiatedByUserId: users[sender].id,
      idempotencyKey: { startsWith: `sched:${created.body.data.schedule.id}:` },
    },
    select: { policySnapshot: true },
  });
  assert.ok(run, "the scheduled run did not post a transfer");
  assert.equal(run.policySnapshot.kycTier.enforced, false);
  assert.equal(run.policySnapshot.kycTier.reason, "NO_KYC_CONTEXT");
});

test("creating a schedule projects its whole lifetime against the tier ceilings", async () => {
  const sender = await actor("sched");
  approved(
    tier([
      limitRow("TRANSFER", { maxAmount: "25000.00" }),
      limitRow("SCHEDULED_TRANSFER", {
        maxAmount: "5000.00",
        dailyAmount: "100.00",
        dailyCount: 1,
        monthlyAmount: "1000.00",
      }),
    ])
  );

  const once = await createSchedule(sender, { amount: "50.00" });
  assert.equal(once.status, 201);

  // One run of 50.00 fits every ceiling; thirty-one of them do not, so the
  // schedule is refused when it is created, not when a run breaches it.
  const daily = await createSchedule(sender, { amount: "50.00", frequency: "DAILY" });
  assert.equal(daily.status, 409);
  assert.equal(daily.body.code, "TIER_SCHEDULED_VOLUME_EXCEEDED");
  assert.equal(daily.body.errors.frequency, "DAILY");
  assert.equal(daily.body.errors.projected, "1550.00");
  assert.equal(daily.body.errors.limit, "1000.00");

  const weekly = await createSchedule(sender, { amount: "200.00", frequency: "WEEKLY" });
  assert.equal(weekly.status, 409);
  assert.equal(weekly.body.code, "TIER_SCHEDULED_VOLUME_EXCEEDED");
  assert.equal(weekly.body.errors.projected, "200.00");
  assert.equal(weekly.body.errors.limit, "100.00");

  const tooLarge = await createSchedule(sender, { amount: "5000.01", frequency: "MONTHLY" });
  assert.equal(tooLarge.status, 409);
  assert.equal(tooLarge.body.code, "TIER_AMOUNT_LIMIT_EXCEEDED");

  assert.deepEqual(
    (
      await prisma.scheduledTransfer.findMany({
        where: { userId: users[sender].id },
        select: { frequency: true },
      })
    ).map((row) => row.frequency),
    ["ONCE"]
  );
});

test("a lower tier can still pause or cancel, but not resume, a schedule", async () => {
  const sender = await actor("lifecycle");
  approved(
    tier([
      limitRow("TRANSFER", { maxAmount: "25000.00" }),
      limitRow("SCHEDULED_TRANSFER", { maxAmount: "5000.00" }),
    ])
  );
  const created = await createSchedule(sender, { amount: "100.00", frequency: "MONTHLY" });
  assert.equal(created.status, 201);
  const scheduleId = created.body.data.schedule.id;

  // Verification dropped to a level with no scheduled-transfer limit at all.
  approved(tier([limitRow("TRANSFER", { maxAmount: "25000.00" })]));

  const pause = await request(app)
    .post(`/api/v1/scheduled-transfers/${scheduleId}/pause`)
    .set("Authorization", `Bearer ${tokens[sender]}`)
    .send({});
  assert.equal(pause.status, 200);

  const resume = await request(app)
    .post(`/api/v1/scheduled-transfers/${scheduleId}/resume`)
    .set("Authorization", `Bearer ${tokens[sender]}`)
    .send({});
  assert.equal(resume.status, 403);
  assert.equal(resume.body.code, "TIER_OPERATION_NOT_ALLOWED");

  const cancel = await request(app)
    .post(`/api/v1/scheduled-transfers/${scheduleId}/cancel`)
    .set("Authorization", `Bearer ${tokens[sender]}`)
    .send({});
  assert.equal(cancel.status, 200);
  assert.equal(
    (await prisma.scheduledTransfer.findUnique({ where: { id: scheduleId } })).status,
    "CANCELLED"
  );
});

test("the tier helper fails closed rather than reading gaps as unlimited", () => {
  assert.equal(tierLimits.limitFor(null, "TRANSFER", "ETB"), null);
  assert.equal(tierLimits.limitFor({ status: "APPROVED" }, "TRANSFER", "ETB"), null);
  assert.equal(tierLimits.limitFor({ tier: null }, "TRANSFER", "ETB"), null);

  // An operation the platform does not gate is a programming error, never a
  // silent pass, whether or not a tier was resolved.
  assert.throws(
    () => tierLimits.limitFor(null, "BOGUS", "ETB"),
    (error) => error.code === "INTERNAL_ERROR" && error.statusCode === 500
  );
  assert.throws(
    () => tierLimits.limitFor({ tier: tier([]) }, "BOGUS", "ETB"),
    (error) => error.code === "INTERNAL_ERROR"
  );
  assert.throws(
    () => tierLimits.limitFor({ tier: tier([]) }, "TRANSFER", "ETB"),
    (error) => error.code === "TIER_OPERATION_NOT_ALLOWED" && error.statusCode === 403
  );

  assert.deepEqual(tierLimits.tierSnapshot(null, undefined), {
    enforced: false,
    reason: "NO_KYC_CONTEXT",
  });
  assert.deepEqual(tierLimits.tierSnapshot(null, { status: "APPROVED", tier: null }), {
    enforced: false,
    reason: "TIER_NOT_CONFIGURED",
  });
  assert.equal(tierLimits.enforcementReason({ tier: { code: "TIER_1" } }), null);
});
