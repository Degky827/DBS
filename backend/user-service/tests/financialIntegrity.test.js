const testDatabaseUrl = process.env.WALLET_TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("WALLET_TEST_DATABASE_URL must point to an isolated test database");
}
const testDatabaseName = new URL(testDatabaseUrl).pathname
  .split("/")
  .pop()
  .split("?")[0];
if (!/_test$/i.test(testDatabaseName)) {
  throw new Error("Financial tests only run against a database whose name ends in _test");
}

process.env.DATABASE_URL = testDatabaseUrl;
process.env.NODE_ENV = "test";
process.env.AUTH_MODE = "dev";
process.env.DEV_API_KEY = "";
process.env.ENABLE_API_DOCS = "false";
process.env.AUTH_RATE_LIMIT_MAX = "1000";
process.env.RATE_LIMIT_MAX = "10000";

const { randomBytes, randomUUID, createHash } = require("node:crypto");
const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("../src/app");
const prisma = require("../src/config/database");
const kycEligibility = require("../src/services/kycEligibility");
const ledger = require("../src/modules/ledger/ledger.service");
const {
  toMinorUnits,
  fromMinorUnits,
  decimalStringToMinorUnits,
} = require("../src/modules/wallets/money");

const users = {};
const tokens = {};
const wallets = {};
const fixtureNames = ["alice", "bob", "charlie", "dave", "eve", "frank", "limitRecipient"];

const createUserAndSession = async (label) => {
  const suffix = randomUUID().replace(/-/g, "");
  const user = await prisma.userProfile.create({
    data: {
      firstName: label,
      lastName: "Financial Test",
      username: `${label.toLowerCase()}_${suffix.slice(0, 12)}`,
      email: `${label.toLowerCase()}_${suffix}@financial.test`,
      phoneNumber: "+15550100",
      dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
      gender: "other",
      passwordHash: "financial-test-only",
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

const approveKyc = () =>
  kycEligibility.setKycClient({
    async getUserKycStatus() {
      return { status: "APPROVED", isApproved: true };
    },
  });

const createWallet = async (label) =>
  request(app)
    .post("/api/v1/wallets")
    .set("Authorization", auth(label))
    .send({});

// Balances are never written directly: every change must come from a balanced
// journal entry so the wallet projection trigger can verify it.
const fundWallet = async (walletId, amount) =>
  prisma.$transaction((tx) =>
    ledger.postEntry({
      tx,
      eventType: "TEST_FUNDING",
      eventRef: `test-funding:${randomUUID()}`,
      currency: "ETB",
      description: "Test funding from opening equity",
      postings: [
        { accountCode: ledger.ACCOUNT_CODES.OPENING_BALANCE, direction: "DEBIT", amount },
        { accountCode: `WALLET:${walletId}`, direction: "CREDIT", amount },
      ],
    })
  );

const fundWalletFromNewAsset = async (walletId, amount) => {
  const account = await prisma.ledgerAccount.create({
    data: {
      code: `TEST:FUNDING:${randomUUID()}`,
      name: "Test funding asset",
      type: "ASSET",
      normalBalance: "DEBIT",
      currency: "ETB",
    },
  });
  return prisma.$transaction((tx) =>
    ledger.postEntry({
      tx,
      eventType: "TEST_FUNDING",
      eventRef: `test-funding:${randomUUID()}`,
      currency: "ETB",
      description: "Test funding from a dedicated asset account",
      postings: [
        { accountId: account.id, direction: "DEBIT", amount },
        { accountCode: `WALLET:${walletId}`, direction: "CREDIT", amount },
      ],
    })
  );
};

const balanceCents = async (label) => {
  const wallet = await prisma.wallet.findUnique({
    where: { userId: users[label].id },
  });
  return decimalStringToMinorUnits(wallet.balance.toString());
};

const getBalance = async (label) => fromMinorUnits(await balanceCents(label));

const ledgerBalanceCents = async (walletId) =>
  decimalStringToMinorUnits(
    (await prisma.ledgerAccount.findUnique({ where: { walletId } })).balance.toString()
  );

const transfer = (label, destinationWalletId, amount, idempotencyKey) => {
  const req = request(app)
    .post("/api/v1/transactions/transfers")
    .set("Authorization", auth(label));
  if (idempotencyKey) req.set("Idempotency-Key", idempotencyKey);
  return req.send({ destinationWalletId, amount });
};

before(async () => {
  approveKyc();
  await prisma.$connect();
  for (const label of fixtureNames) await createUserAndSession(label);
  for (const label of ["alice", "bob", "eve", "frank", "limitRecipient"]) {
    const response = await createWallet(label);
    assert.equal(response.status, 201, `wallet for ${label}`);
    wallets[label] = response.body.data.wallet;
  }
});

after(async () => {
  kycEligibility.setKycClient(null);
  const userIds = Object.values(users)
    .map((u) => u?.id)
    .filter(Boolean);
  try {
    // Posted ledger records are immutable by design; financial fixtures stay in
    // the disposable test database, so only sessions are removed.
    await prisma.devSession.deleteMany({ where: { userId: { in: userIds } } });
  } finally {
    await prisma.$disconnect();
  }
});

test("wallet balance never goes below zero", async () => {
  await fundWallet(wallets.alice.id, "10.00");
  const aliceBefore = await balanceCents("alice");
  const bobBefore = await balanceCents("bob");

  const response = await transfer("alice", wallets.bob.id, "15.00", randomUUID());

  assert.equal(response.status, 409);
  assert.equal(await balanceCents("alice"), aliceBefore);
  assert.equal(await balanceCents("bob"), bobBefore);
});

test("concurrent transfers respect balance atomicity", async () => {
  await fundWallet(wallets.alice.id, "100.00");
  const aliceBefore = await balanceCents("alice");
  const bobBefore = await balanceCents("bob");

  const [resp1, resp2] = await Promise.all([
    transfer("alice", wallets.bob.id, "60.00", randomUUID()),
    transfer("alice", wallets.bob.id, "60.00", randomUUID()),
  ]);

  assert.deepEqual(
    [resp1.status, resp2.status].sort(),
    [201, 409],
    "one transfer should succeed and one should fail"
  );
  assert.equal(await balanceCents("alice"), aliceBefore - 6000n);
  assert.equal(await balanceCents("bob"), bobBefore + 6000n);
  assert.equal(await ledgerBalanceCents(wallets.alice.id), aliceBefore - 6000n);
});

test("monetary arithmetic uses exact precision (no floating-point errors)", async () => {
  await fundWallet(wallets.eve.id, "0.10");
  await fundWallet(wallets.frank.id, "0.20");

  for (const amount of ["0.01", "0.02", "0.03"]) {
    const response = await transfer("eve", wallets.frank.id, amount, randomUUID());
    assert.equal(response.status, 201);
  }

  assert.equal(await getBalance("eve"), "0.04");
  assert.equal(await getBalance("frank"), "0.26");

  // 0.04 + 0.20 is 0.24000000000000002 in floating point; the ledger must keep 0.24.
  const response = await transfer("frank", wallets.eve.id, "0.20", randomUUID());
  assert.equal(response.status, 201);
  assert.equal(await getBalance("eve"), "0.24");
  assert.equal(await getBalance("frank"), "0.06");
});

test("wallet balance limits are enforced", async () => {
  await fundWallet(wallets.alice.id, "1.00");
  await fundWalletFromNewAsset(wallets.limitRecipient.id, "99999999999999999.98");
  const aliceBefore = await balanceCents("alice");

  const response = await transfer("alice", wallets.limitRecipient.id, "1.00", randomUUID());

  assert.equal(response.status, 409);
  assert.match(response.body.message, /balance limit/i);
  assert.equal(await getBalance("limitRecipient"), "99999999999999999.98");
  assert.equal(await balanceCents("alice"), aliceBefore);
});

test("transaction amounts use two-decimal normalization", async () => {
  await fundWallet(wallets.alice.id, "200.00");

  const invalidAmounts = ["10.123", "10.", ".10", "1e2", "0x10"];
  for (const amount of invalidAmounts) {
    const response = await transfer("alice", wallets.bob.id, amount, randomUUID());
    assert.equal(response.status, 400, `Amount ${amount} should be rejected`);
  }

  const validAmounts = [
    ["10", "10.00"],
    ["10.1", "10.10"],
    ["10.00", "10.00"],
    ["0.01", "0.01"],
  ];
  for (const [amount, normalized] of validAmounts) {
    const response = await transfer("alice", wallets.bob.id, amount, randomUUID());
    assert.equal(response.status, 201, `Amount ${amount} should be accepted`);
    assert.equal(response.body.data.transaction.amount, normalized);
  }
});

test("zero and negative amounts are rejected", async () => {
  await fundWallet(wallets.alice.id, "100.00");

  const invalidAmounts = ["0.00", "-1.00", "-0.01"];

  for (const amount of invalidAmounts) {
    const response = await transfer("alice", wallets.bob.id, amount, randomUUID());
    assert.equal(response.status, 400);
    assert.match(response.body.errors.amount, /amount/i);
  }
});

test("idempotency prevents duplicate financial effects", async () => {
  await fundWallet(wallets.alice.id, "100.00");
  const aliceBefore = await balanceCents("alice");
  const bobBefore = await balanceCents("bob");
  const idempotencyKey = randomUUID();

  const resp1 = await transfer("alice", wallets.bob.id, "10.00", idempotencyKey);
  const resp2 = await transfer("alice", wallets.bob.id, "10.00", idempotencyKey);

  assert.equal(resp1.status, 201);
  assert.equal(resp2.status, 200);
  assert.equal(await balanceCents("alice"), aliceBefore - 1000n);
  assert.equal(await balanceCents("bob"), bobBefore + 1000n);
  assert.equal(
    resp1.body.data.transaction.reference,
    resp2.body.data.transaction.reference
  );

  const resp3 = await transfer("alice", wallets.bob.id, "20.00", idempotencyKey);
  assert.equal(resp3.status, 409);
  assert.match(resp3.body.message, /idempotency.*(diff|conflict)/i);
});

test("transaction history reflects exact chronological order", async () => {
  await fundWallet(wallets.alice.id, "100.00");

  const transfers = [];
  for (let i = 1; i <= 5; i++) {
    const response = await transfer("alice", wallets.bob.id, `${i}.00`, randomUUID());
    assert.equal(response.status, 201);
    transfers.push(response.body.data.transaction);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  const history = await request(app)
    .get("/api/v1/transactions")
    .set("Authorization", auth("alice"));

  assert.equal(history.status, 200);
  const newest = history.body.data.transactions.slice(0, transfers.length);
  assert.deepEqual(
    newest.map((row) => row.reference),
    transfers.map((row) => row.reference).reverse()
  );
});

test("failed transfers leave no partial state", async () => {
  await fundWallet(wallets.alice.id, "100.00");
  const aliceBefore = await balanceCents("alice");
  const bobBefore = await balanceCents("bob");

  const initialTransactionCount = await prisma.transaction.count({
    where: { initiatedByUserId: users.alice.id },
  });

  await prisma.wallet.update({
    where: { id: wallets.bob.id },
    data: { isActive: false },
  });

  const response = await transfer("alice", wallets.bob.id, "10.00", randomUUID());
  assert.equal(response.status, 409);

  assert.equal(await balanceCents("alice"), aliceBefore);
  assert.equal(await balanceCents("bob"), bobBefore);
  assert.equal(
    await prisma.transaction.count({ where: { initiatedByUserId: users.alice.id } }),
    initialTransactionCount
  );

  await prisma.wallet.update({
    where: { id: wallets.bob.id },
    data: { isActive: true },
  });
});

test("transaction references are unique and URL-safe", async () => {
  await fundWallet(wallets.alice.id, "20.00");

  const references = new Set();

  for (let i = 0; i < 10; i++) {
    const response = await transfer("alice", wallets.bob.id, "1.00", randomUUID());
    assert.equal(response.status, 201);

    const reference = response.body.data.transaction.reference;
    assert.ok(!references.has(reference), `Duplicate reference: ${reference}`);
    references.add(reference);
    assert.match(reference, /^[A-Za-z0-9_-]+$/);
    assert.ok(reference.length >= 16 && reference.length <= 64);
  }
});

test("wallet balances match sum of transactions", async () => {
  await fundWallet(wallets.alice.id, "100.00");
  const aliceBefore = await balanceCents("alice");
  const bobBefore = await balanceCents("bob");

  const amounts = ["10.00", "5.50", "3.25"];
  for (const amount of amounts) {
    const response = await transfer("alice", wallets.bob.id, amount, randomUUID());
    assert.equal(response.status, 201);
    assert.equal(response.body.data.transaction.amount, amount);
  }

  const moved = amounts.reduce((total, amount) => total + toMinorUnits(amount), 0n);
  assert.equal(moved, 1875n);
  assert.equal(await balanceCents("alice"), aliceBefore - moved);
  assert.equal(await balanceCents("bob"), bobBefore + moved);
  assert.equal(await ledgerBalanceCents(wallets.alice.id), aliceBefore - moved);
  assert.equal(await ledgerBalanceCents(wallets.bob.id), bobBefore + moved);
});

test("transaction status transitions are valid", async () => {
  await fundWallet(wallets.alice.id, "10.00");

  const response = await transfer("alice", wallets.bob.id, "10.00", randomUUID());
  assert.equal(response.status, 201);

  const transaction = response.body.data.transaction;
  assert.equal(transaction.status, "POSTED");
  assert.equal(transaction.type, "TRANSFER");
  assert.equal(transaction.feeAmount, "0.00");
  assert.equal(transaction.reversedAmount, "0.00");
  assert.match(transaction.ledgerEntryReference, /^JRN-[A-Za-z0-9]+$/);

  const dbTransaction = await prisma.transaction.findUnique({
    where: { reference: transaction.reference },
    include: { journalEntry: { select: { status: true, reference: true } } },
  });
  assert.equal(dbTransaction.status, "POSTED");
  assert.equal(dbTransaction.journalEntry.status, "POSTED");
  assert.equal(dbTransaction.journalEntry.reference, transaction.ledgerEntryReference);

  await assert.rejects(
    prisma.transaction.update({
      where: { id: dbTransaction.id },
      data: { amount: "11.00" },
    }),
    /immutable/
  );
});

test("database constraints prevent inconsistent financial state", async () => {
  try {
    await prisma.wallet.create({
      data: {
        id: randomUUID(),
        userId: users.charlie.id,
        balance: "-10.00",
        currency: "ETB",
        isActive: true,
      },
    });
    assert.fail("Should not allow negative balance");
  } catch (error) {
    assert.ok(error.message.includes("check") || error.message.includes("constraint"));
  }

  const invalidResponse = await transfer("alice", wallets.bob.id, "-5.00", randomUUID());
  assert.equal(invalidResponse.status, 400);

  const balanceBefore = await balanceCents("alice");
  await assert.rejects(
    prisma.wallet.update({
      where: { id: wallets.alice.id },
      data: { balance: { increment: 1 } },
    }),
    /does not match ledger/
  );
  assert.equal(await balanceCents("alice"), balanceBefore);
});

test("rate limiting does not affect financial integrity", async () => {
  await fundWallet(wallets.alice.id, "20.00");
  const aliceBefore = await balanceCents("alice");

  const transfers = [];
  for (let i = 0; i < 20; i++) {
    transfers.push(transfer("alice", wallets.bob.id, "1.00", randomUUID()));
  }

  const responses = await Promise.all(transfers);
  const succeeded = responses.filter((r) => r.status === 201).length;
  const rateLimited = responses.filter((r) => r.status === 429).length;
  const rejected = responses.filter((r) => r.status === 409).length;
  assert.equal(succeeded + rateLimited + rejected, responses.length);

  assert.equal(await balanceCents("alice"), aliceBefore - BigInt(succeeded) * 100n);
  assert.equal(await ledgerBalanceCents(wallets.alice.id), aliceBefore - BigInt(succeeded) * 100n);
});

test("inactive wallets cannot send or receive funds", async () => {
  await fundWallet(wallets.alice.id, "100.00");
  const aliceBefore = await balanceCents("alice");

  await prisma.wallet.update({
    where: { id: wallets.alice.id },
    data: { isActive: false },
  });

  const sendResponse = await transfer("alice", wallets.bob.id, "10.00", randomUUID());
  assert.equal(sendResponse.status, 409);

  await prisma.wallet.update({
    where: { id: wallets.alice.id },
    data: { isActive: true },
  });
  await prisma.wallet.update({
    where: { id: wallets.bob.id },
    data: { isActive: false },
  });

  const receiveResponse = await transfer("alice", wallets.bob.id, "10.00", randomUUID());
  assert.equal(receiveResponse.status, 409);
  assert.equal(await balanceCents("alice"), aliceBefore);

  await prisma.wallet.update({
    where: { id: wallets.bob.id },
    data: { isActive: true },
  });
});
