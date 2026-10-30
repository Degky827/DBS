const testDatabaseUrl = process.env.WALLET_TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("WALLET_TEST_DATABASE_URL must point to an isolated test database");
}
const testDatabaseName = new URL(testDatabaseUrl).pathname
  .split("/")
  .pop()
  .split("?")[0];
if (!/_test$/i.test(testDatabaseName)) {
  throw new Error("Policy tests only run against a database whose name ends in _test");
}

process.env.DATABASE_URL = testDatabaseUrl;
process.env.NODE_ENV = "test";
process.env.AUTH_MODE = "dev";
process.env.DEV_API_KEY = "";
process.env.AUTH_RATE_LIMIT_MAX = "1000";
process.env.RATE_LIMIT_MAX = "10000";

const { createHash, randomBytes, randomUUID } = require("node:crypto");
const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("../src/app");
const prisma = require("../src/config/database");
const kycEligibility = require("../src/services/kycEligibility");
const ledger = require("../src/modules/ledger/ledger.service");
const policies = require("../src/modules/policies/policies.service");
const {
  fromMinorUnits,
  decimalStringToMinorUnits,
} = require("../src/modules/wallets/money");

const users = {};
const tokens = {};
const wallets = {};

const createUserAndSession = async (label, role = "USER") => {
  const suffix = randomUUID().replace(/-/g, "");
  const user = await prisma.userProfile.create({
    data: {
      firstName: label,
      lastName: "Policy Test",
      username: `${label}_${suffix.slice(0, 12)}`,
      email: `${label}_${suffix}@policy.test`,
      phoneNumber: "+15550177",
      dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
      gender: "other",
      passwordHash: "policy-test-only",
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

const fundWallet = async (walletId, amount) =>
  prisma.$transaction((tx) =>
    ledger.postEntry({
      tx,
      eventType: "TEST_FUNDING",
      eventRef: `test-funding:${randomUUID()}`,
      currency: "ETB",
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

const transfer = (label, amount, idempotencyKey = randomUUID()) =>
  request(app)
    .post("/api/v1/transactions/transfers")
    .set("Authorization", `Bearer ${tokens[label]}`)
    .set("Idempotency-Key", idempotencyKey)
    .send({ destinationWalletId: wallets.recipient.id, amount });

const balanceOf = async (label) =>
  (await prisma.wallet.findUnique({ where: { id: wallets[label].id } })).balance;

const transferPolicy = () =>
  prisma.financialPolicy.findUnique({
    where: { type_currency: { type: "TRANSFER", currency: "ETB" } },
  });

const restoreTransferPolicy = () =>
  prisma.financialPolicy.update({
    where: { type_currency: { type: "TRANSFER", currency: "ETB" } },
    data: {
      feeType: "NONE",
      feeFlat: "0.00",
      feeBps: 0,
      feeMin: "0.00",
      feeMax: null,
      dailyOutgoingAmount: "500000.00",
      dailyOutgoingCount: 100,
    },
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
  await createUserAndSession("admin", "ADMIN");
  await fundWallet(wallets.sender.id, "1000.00");
});

after(async () => {
  kycEligibility.setKycClient(null);
  try {
    await restoreTransferPolicy();
  } finally {
    await prisma.$disconnect();
  }
});

test("fees are calculated with exact half-up integer arithmetic", () => {
  const percentage = {
    feeType: "PERCENTAGE",
    feeFlat: "0.00",
    feeBps: 255,
    feeMin: "0.00",
    feeMax: null,
  };
  assert.equal(policies.calculateFeeCents(percentage, 100n), 3n);
  assert.equal(policies.calculateFeeCents(percentage, 40n), 1n);

  assert.equal(
    policies.calculateFeeCents({ ...percentage, feeMin: "0.50" }, 100n),
    50n
  );
  assert.equal(
    policies.calculateFeeCents({ ...percentage, feeMax: "0.02" }, 100n),
    2n
  );
  assert.equal(
    policies.calculateFeeCents(
      { feeType: "FLAT_PLUS_PERCENTAGE", feeFlat: "0.25", feeBps: 100, feeMin: "0.00", feeMax: null },
      1000n
    ),
    35n
  );
  assert.equal(
    policies.calculateFeeCents(
      { feeType: "NONE", feeFlat: "1.00", feeBps: 500, feeMin: "0.00", feeMax: null },
      1000n
    ),
    0n
  );
  assert.throws(
    () =>
      policies.calculateFeeCents(
        { ...percentage, feeType: "UNKNOWN" },
        100n
      ),
    (error) => error.code === "INVALID_FEE_POLICY"
  );
});

test("business dates use the configured IANA timezone", () => {
  const date = new Date("2026-10-28T21:30:00.000Z");
  assert.equal(policies.businessDateFor("Africa/Addis_Ababa", date), "2026-10-29");
  assert.equal(policies.businessDateFor("UTC", date), "2026-10-28");
  assert.throws(
    () => policies.businessDateFor("Not/AZone", date),
    (error) => error.code === "VALIDATION_ERROR"
  );
});

test("only administrators can change financial policies and changes are versioned", async () => {
  const before = await transferPolicy();
  const revisionCount = await prisma.financialPolicyRevision.count({
    where: { policyId: before.id },
  });

  const forbidden = await request(app)
    .patch("/api/v1/admin/financial-policies/TRANSFER")
    .set("Authorization", `Bearer ${tokens.sender}`)
    .send({ dailyOutgoingCount: 7, reason: "Customer support request" });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.code, "FORBIDDEN_ROLE");

  const updated = await request(app)
    .patch("/api/v1/admin/financial-policies/TRANSFER")
    .set("Authorization", `Bearer ${tokens.admin}`)
    .send({ dailyOutgoingCount: 7, reason: "Customer support request" });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.policy.dailyOutgoingCount, 7);

  const revisions = await prisma.financialPolicyRevision.findMany({
    where: { policyId: before.id },
    orderBy: { createdAt: "desc" },
  });
  assert.equal(revisions.length, revisionCount + 1);
  assert.equal(revisions[0].reason, "Customer support request");
  assert.equal(revisions[0].changedBy, users.admin.id);
  assert.equal(revisions[0].snapshot.dailyOutgoingCount, 7);

  await restoreTransferPolicy();
});

test("daily count limits are enforced even for concurrent transfers", async () => {
  const policy = await transferPolicy();
  try {
    await prisma.financialPolicy.update({
      where: { id: policy.id },
      data: { dailyOutgoingCount: 1, dailyOutgoingAmount: "500000.00" },
    });

    const responses = await Promise.all([
      transfer("sender", "1.00"),
      transfer("sender", "1.00"),
    ]);
    assert.deepEqual(
      responses.map((response) => response.status).sort(),
      [201, 409]
    );
    const rejected = responses.find((response) => response.status === 409);
    assert.equal(rejected.body.code, "DAILY_COUNT_EXCEEDED");
    assert.equal(
      await prisma.transaction.count({
        where: {
          initiatedByUserId: users.sender.id,
          businessDate: new Date(policies.businessDateFor(policy.timezone) + "T00:00:00.000Z"),
        },
      }),
      1
    );
  } finally {
    await restoreTransferPolicy();
  }
});

test("daily outgoing amount limits use the fee-inclusive total", async () => {
  const policy = await transferPolicy();
  try {
    const usedSoFar = await prisma.transaction.aggregate({
      where: {
        initiatedByUserId: users.sender.id,
        type: "TRANSFER",
        status: { in: ["POSTED", "PARTIALLY_REVERSED"] },
        businessDate: new Date(
          policies.businessDateFor(policy.timezone) + "T00:00:00.000Z"
        ),
      },
      _sum: { amount: true, feeAmount: true },
    });
    const usedCents =
      decimalStringToMinorUnits(usedSoFar._sum.amount?.toFixed(2) ?? "0.00") +
      decimalStringToMinorUnits(usedSoFar._sum.feeAmount?.toFixed(2) ?? "0.00");

    // Exactly one more 1.00 transfer plus its 0.50 fee fits under the limit.
    await prisma.financialPolicy.update({
      where: { id: policy.id },
      data: {
        dailyOutgoingCount: 100,
        dailyOutgoingAmount: fromMinorUnits(usedCents + 150n),
        feeType: "FLAT",
        feeFlat: "0.50",
        feeBps: 0,
        feeMin: "0.00",
        feeMax: null,
      },
    });

    const first = await transfer("sender", "1.00");
    assert.equal(first.status, 201);
    assert.equal(first.body.data.transaction.feeAmount, "0.50");

    const overLimit = await transfer("sender", "1.00");
    assert.equal(overLimit.status, 409);
    assert.equal(overLimit.body.code, "DAILY_LIMIT_EXCEEDED");
  } finally {
    await restoreTransferPolicy();
  }
});

test("configured fees post to fee revenue and are refunded by a full reversal", async () => {
  const policy = await transferPolicy();
  const feeAccount = await prisma.ledgerAccount.findUnique({
    where: { code: ledger.ACCOUNT_CODES.FEE_REVENUE },
  });
  try {
    await prisma.financialPolicy.update({
      where: { id: policy.id },
      data: {
        dailyOutgoingCount: 100,
        dailyOutgoingAmount: "500000.00",
        feeType: "PERCENTAGE",
        feeFlat: "0.00",
        feeBps: 255,
        feeMin: "0.00",
        feeMax: null,
      },
    });

    const senderBefore = await balanceOf("sender");
    const recipientBefore = await balanceOf("recipient");
    const feeBefore = feeAccount.balance;

    const created = await transfer("sender", "1.00");
    assert.equal(created.status, 201);
    assert.equal(created.body.data.transaction.feeAmount, "0.03");
    assert.equal(
      (await balanceOf("sender")).toFixed(2),
      senderBefore.minus("1.03").toFixed(2)
    );
    assert.equal(
      (await balanceOf("recipient")).toFixed(2),
      recipientBefore.plus("1.00").toFixed(2)
    );
    const feeAfter = await prisma.ledgerAccount.findUnique({
      where: { code: ledger.ACCOUNT_CODES.FEE_REVENUE },
    });
    assert.equal(feeAfter.balance.toFixed(2), feeBefore.plus("0.03").toFixed(2));

    const reversal = await request(app)
      .post(
        `/api/v1/transactions/${created.body.data.transaction.reference}/reversals`
      )
      .set("Authorization", `Bearer ${tokens.admin}`)
      .set("Idempotency-Key", `fee_reversal_${randomUUID()}`)
      .send({ reason: "Fee refund for failed transfer" });
    assert.equal(reversal.status, 201);
    assert.equal(reversal.body.data.transaction.status, "REVERSED");
    assert.equal(
      (await balanceOf("sender")).toFixed(2),
      senderBefore.toFixed(2)
    );
    assert.equal(
      (await balanceOf("recipient")).toFixed(2),
      recipientBefore.toFixed(2)
    );
    const feeRestored = await prisma.ledgerAccount.findUnique({
      where: { code: ledger.ACCOUNT_CODES.FEE_REVENUE },
    });
    assert.equal(feeRestored.balance.toFixed(2), feeBefore.toFixed(2));
  } finally {
    await restoreTransferPolicy();
  }
});
