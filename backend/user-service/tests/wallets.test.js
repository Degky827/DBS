const testDatabaseUrl = process.env.WALLET_TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("WALLET_TEST_DATABASE_URL must point to an isolated test database");
}
const testDatabaseName = new URL(testDatabaseUrl).pathname
  .split("/")
  .pop()
  .split("?")[0];
if (!/_test$/i.test(testDatabaseName)) {
  throw new Error("Wallet tests only run against a database whose name ends in _test");
}

process.env.DATABASE_URL = testDatabaseUrl;
process.env.NODE_ENV = "test";
process.env.AUTH_MODE = "dev";
process.env.DEV_API_KEY = "";
process.env.ENABLE_API_DOCS = "true";
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
const { toMinorUnits, fromMinorUnits } = require("../src/modules/wallets/money");

const users = {};
const tokens = {};
const wallets = {};
const fixtureNames = [
  "owner",
  "recipient",
  "outsider",
  "concurrentSender",
  "concurrentRecipient",
  "rollbackSender",
  "rollbackRecipient",
  "admin",
];

const createUserAndSession = async (label, role = "USER") => {
  const suffix = randomUUID().replace(/-/g, "");
  const user = await prisma.userProfile.create({
    data: {
      firstName: label,
      lastName: "Wallet Test",
      username: `${label.toLowerCase()}_${suffix.slice(0, 12)}`,
      email: `${label.toLowerCase()}_${suffix}@wallet.test`,
      phoneNumber: "+15550199",
      dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
      gender: "other",
      passwordHash: "wallet-test-only",
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

const approveKyc = () =>
  kycEligibility.setKycClient({
    async getUserKycStatus() {
      return { status: "APPROVED", isApproved: true };
    },
  });

// Wallet.balance is a projection of the wallet's ledger account. Tests fund
// wallets through a balanced opening-balance entry instead of writing balances
// directly, matching how production money enters the ledger.
const fundWallet = async (walletId, amount) =>
  prisma.$transaction((tx) =>
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
          amount,
        },
        {
          accountCode: `WALLET:${walletId}`,
          direction: "CREDIT",
          amount,
        },
      ],
    })
  );

// Near-limit funding needs a fresh asset account each time so the accumulated
// opening-equity balance cannot overflow the supported decimal range.
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

const ledgerBalance = async (walletId) =>
  (await prisma.ledgerAccount.findUnique({ where: { walletId } })).balance.toFixed(2);

const createWallet = async (label) =>
  request(app)
    .post("/api/v1/wallets")
    .set("Authorization", auth(label))
    .send({});

const transfer = (label, destinationWalletId, amount, idempotencyKey) => {
  const req = request(app)
    .post("/api/v1/transactions/transfers")
    .set("Authorization", auth(label));
  if (idempotencyKey) req.set("Idempotency-Key", idempotencyKey);
  return req.send({ destinationWalletId, amount });
};

const walletBalance = async (label) => {
  const wallet = await prisma.wallet.findUnique({
    where: { userId: users[label].id },
  });
  return wallet.balance.toFixed(2);
};

before(async () => {
  approveKyc();
  await prisma.$connect();
  for (const label of fixtureNames) {
    await createUserAndSession(label, label === "admin" ? "ADMIN" : "USER");
  }
});

after(async () => {
  kycEligibility.setKycClient(null);
  const userIds = fixtureNames.map((label) => users[label]?.id).filter(Boolean);
  try {
    // Posted ledger records are immutable by design, so financial fixtures are
    // intentionally left in the disposable test database; only sessions are
    // removed to keep the suite repeatable.
    await prisma.devSession.deleteMany({ where: { userId: { in: userIds } } });
  } finally {
    await prisma.$disconnect();
  }
});

test("wallet creation is authenticated and limited to one per customer", async () => {
  for (const label of fixtureNames) {
    const response = await createWallet(label);
    assert.equal(response.status, 201);
    assert.equal(response.body.data.wallet.balance, "0.00");
    assert.equal(response.body.data.wallet.currency, "ETB");
    assert.equal(response.body.data.wallet.isActive, true);
    wallets[label] = response.body.data.wallet;
  }

  const duplicate = await createWallet("owner");
  assert.equal(duplicate.status, 409);

  const unauthenticated = await request(app).post("/api/v1/wallets").send({});
  assert.equal(unauthenticated.status, 401);
});

test("wallet creation and transfers reject users without KYC approval", async () => {
  kycEligibility.setKycClient({
    async getUserKycStatus() {
      return { status: "PENDING_REVIEW", isApproved: false };
    },
  });

  try {
    const balanceBefore = await walletBalance("owner");
    const create = await createWallet("owner");
    assert.equal(create.status, 403);
    assert.equal(create.body.code, "KYC_NOT_APPROVED");

    const move = await transfer(
      "owner",
      wallets.recipient.id,
      "1.00",
      `kyc_rejected_${randomUUID()}`
    );
    assert.equal(move.status, 403);
    assert.equal(move.body.code, "KYC_NOT_APPROVED");
    assert.equal(await walletBalance("owner"), balanceBefore);
  } finally {
    approveKyc();
  }
});

test("financial operations fail closed when KYC status is unavailable", async () => {
  kycEligibility.setKycClient({
    async getUserKycStatus() {
      throw new Error("kyc-service down");
    },
  });

  try {
    const balanceBefore = await walletBalance("owner");
    const move = await transfer(
      "owner",
      wallets.recipient.id,
      "1.00",
      `kyc_unavailable_${randomUUID()}`
    );
    assert.equal(move.status, 503);
    assert.equal(move.body.code, "KYC_STATUS_UNAVAILABLE");
    assert.equal(await walletBalance("owner"), balanceBefore);
  } finally {
    approveKyc();
  }
});

test("balance retrieval and wallet access are restricted to the owner", async () => {
  const ownWallet = await request(app)
    .get("/api/v1/wallets/me")
    .set("Authorization", auth("owner"));
  assert.equal(ownWallet.status, 200);
  assert.equal(ownWallet.body.data.wallet.id, wallets.owner.id);
  assert.equal(ownWallet.body.data.wallet.balance, "0.00");

  const ownWalletById = await request(app)
    .get(`/api/v1/wallets/${wallets.owner.id}`)
    .set("Authorization", auth("owner"));
  assert.equal(ownWalletById.status, 200);

  const foreignWallet = await request(app)
    .get(`/api/v1/wallets/${wallets.owner.id}`)
    .set("Authorization", auth("outsider"));
  assert.equal(foreignWallet.status, 404);
});

test("transfer rejects missing idempotency keys and invalid amounts", async () => {
  const missingKey = await transfer(
    "owner",
    wallets.recipient.id,
    "1.00",
    undefined
  );
  assert.equal(missingKey.status, 400);

  for (const amount of ["0", "-1.00", "1.001", "1e2", 1]) {
    const response = await transfer(
      "owner",
      wallets.recipient.id,
      amount,
      `invalid_${randomUUID()}`
    );
    assert.equal(response.status, 400);
  }

  const unauthorized = await request(app)
    .post("/api/v1/transactions/transfers")
    .send({ destinationWalletId: wallets.recipient.id, amount: "1.00" });
  assert.equal(unauthorized.status, 401);
});

test("transfer rejects invalid and self-recipient wallets", async () => {
  const missingWallet = await transfer(
    "owner",
    randomUUID(),
    "1.00",
    `missing_${randomUUID()}`
  );
  assert.equal(missingWallet.status, 404);

  const selfTransfer = await transfer(
    "owner",
    wallets.owner.id,
    "1.00",
    `self_${randomUUID()}`
  );
  assert.equal(selfTransfer.status, 400);
});

test("successful transfers update balances and are idempotent", async () => {
  await fundWallet(wallets.owner.id, "100.00");

  const key = `successful_${randomUUID()}`;
  const created = await transfer("owner", wallets.recipient.id, "20.25", key);
  assert.equal(created.status, 201);
  assert.equal(created.body.data.transaction.amount, "20.25");
  assert.equal(created.body.data.transaction.type, "TRANSFER");

  const replay = await transfer("owner", wallets.recipient.id, "20.25", key);
  assert.equal(replay.status, 200);
  assert.equal(
    replay.body.data.transaction.reference,
    created.body.data.transaction.reference
  );
  assert.equal(await walletBalance("owner"), "79.75");
  assert.equal(await walletBalance("recipient"), "20.25");
  assert.equal(await ledgerBalance(wallets.owner.id), "79.75");
  assert.equal(await ledgerBalance(wallets.recipient.id), "20.25");

  const secondTransfer = await transfer(
    "owner",
    wallets.recipient.id,
    "1.00",
    `pagination_${randomUUID()}`
  );
  assert.equal(secondTransfer.status, 201);

  const reusedKey = await transfer("owner", wallets.recipient.id, "20.00", key);
  assert.equal(reusedKey.status, 409);

  const senderHistory = await request(app)
    .get("/api/v1/transactions")
    .set("Authorization", auth("owner"));
  assert.equal(senderHistory.status, 200);
  assert.equal(senderHistory.body.data.transactions.length, 2);

  const firstPage = await request(app)
    .get("/api/v1/transactions?limit=1&direction=outgoing")
    .set("Authorization", auth("owner"));
  assert.equal(firstPage.status, 200);
  assert.equal(firstPage.body.data.transactions.length, 1);
  assert.equal(firstPage.body.data.page.hasMore, true);

  const secondPage = await request(app)
    .get(
      `/api/v1/transactions?limit=1&direction=outgoing&cursor=${firstPage.body.data.page.nextCursor}`
    )
    .set("Authorization", auth("owner"));
  assert.equal(secondPage.status, 200);
  assert.equal(secondPage.body.data.transactions.length, 1);
  assert.equal(secondPage.body.data.page.hasMore, false);

  const incomingHistory = await request(app)
    .get("/api/v1/transactions?direction=incoming")
    .set("Authorization", auth("recipient"));
  assert.equal(incomingHistory.status, 200);
  assert.equal(incomingHistory.body.data.transactions.length, 2);

  const invalidFilter = await request(app)
    .get("/api/v1/transactions?limit=101")
    .set("Authorization", auth("owner"));
  assert.equal(invalidFilter.status, 400);

  const invalidDateRange = await request(app)
    .get(
      "/api/v1/transactions?from=2026-10-28T00%3A00%3A00.000Z&to=2026-10-27T00%3A00%3A00.000Z"
    )
    .set("Authorization", auth("owner"));
  assert.equal(invalidDateRange.status, 400);

  const futureHistory = await request(app)
    .get("/api/v1/transactions?from=2030-01-01T00%3A00%3A00Z")
    .set("Authorization", auth("owner"));
  assert.equal(futureHistory.status, 200);
  assert.equal(futureHistory.body.data.transactions.length, 0);

  const foreignCursor = await request(app)
    .get(`/api/v1/transactions?cursor=${randomUUID()}`)
    .set("Authorization", auth("recipient"));
  assert.equal(foreignCursor.status, 400);

  const receiverHistory = await request(app)
    .get(`/api/v1/transactions/${created.body.data.transaction.reference}`)
    .set("Authorization", auth("recipient"));
  assert.equal(receiverHistory.status, 200);

  const privateHistory = await request(app)
    .get(`/api/v1/transactions/${created.body.data.transaction.reference}`)
    .set("Authorization", auth("outsider"));
  assert.equal(privateHistory.status, 404);
});

test("insufficient funds leave both wallets and history unchanged", async () => {
  const beforeSource = await walletBalance("owner");
  const beforeDestination = await walletBalance("recipient");
  const response = await transfer(
    "owner",
    wallets.recipient.id,
    "1000.00",
    `insufficient_${randomUUID()}`
  );

  assert.equal(response.status, 409);
  assert.equal(response.body.message, "Insufficient wallet balance");
  assert.equal(await walletBalance("owner"), beforeSource);
  assert.equal(await walletBalance("recipient"), beforeDestination);
  const history = await prisma.transaction.count({
    where: { initiatedByUserId: users.owner.id },
  });
  assert.equal(history, 2);
});

test("transfers reject inactive source or destination wallets", async () => {
  const sourceBefore = await walletBalance("owner");
  const destinationBefore = await walletBalance("recipient");
  const transactionsBefore = await prisma.transaction.count({
    where: { initiatedByUserId: users.owner.id },
  });

  await prisma.wallet.update({
    where: { id: wallets.owner.id },
    data: { isActive: false },
  });
  const inactiveSource = await transfer(
    "owner",
    wallets.recipient.id,
    "1.00",
    `inactive_source_${randomUUID()}`
  );
  assert.equal(inactiveSource.status, 409);

  await prisma.wallet.update({
    where: { id: wallets.owner.id },
    data: { isActive: true },
  });
  await prisma.wallet.update({
    where: { id: wallets.recipient.id },
    data: { isActive: false },
  });
  const inactiveDestination = await transfer(
    "owner",
    wallets.recipient.id,
    "1.00",
    `inactive_destination_${randomUUID()}`
  );
  assert.equal(inactiveDestination.status, 409);

  await prisma.wallet.update({
    where: { id: wallets.recipient.id },
    data: { isActive: true },
  });
  assert.equal(await walletBalance("owner"), sourceBefore);
  assert.equal(await walletBalance("recipient"), destinationBefore);
  assert.equal(
    await prisma.transaction.count({
      where: { initiatedByUserId: users.owner.id },
    }),
    transactionsBefore
  );
});

test("concurrent transfers cannot spend the same balance twice", async () => {
  await fundWallet(wallets.concurrentSender.id, "100.00");

  const responses = await Promise.all([
    transfer(
      "concurrentSender",
      wallets.concurrentRecipient.id,
      "70.00",
      `concurrent_a_${randomUUID()}`
    ),
    transfer(
      "concurrentSender",
      wallets.concurrentRecipient.id,
      "70.00",
      `concurrent_b_${randomUUID()}`
    ),
  ]);
  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [201, 409]
  );
  assert.equal(await walletBalance("concurrentSender"), "30.00");
  assert.equal(await walletBalance("concurrentRecipient"), "70.00");
  assert.equal(
    await prisma.transaction.count({
      where: { initiatedByUserId: users.concurrentSender.id },
    }),
    1
  );

  const duplicateKey = `concurrent_duplicate_${randomUUID()}`;
  const duplicateResponses = await Promise.all([
    transfer(
      "concurrentSender",
      wallets.concurrentRecipient.id,
      "5.00",
      duplicateKey
    ),
    transfer(
      "concurrentSender",
      wallets.concurrentRecipient.id,
      "5.00",
      duplicateKey
    ),
  ]);
  assert.deepEqual(
    duplicateResponses.map((response) => response.status).sort(),
    [200, 201]
  );
  assert.equal(await walletBalance("concurrentSender"), "25.00");
  assert.equal(await walletBalance("concurrentRecipient"), "75.00");
  assert.equal(
    await prisma.transaction.count({
      where: { initiatedByUserId: users.concurrentSender.id },
    }),
    2
  );
});

test("a failed destination credit rolls back the source debit and transaction", async () => {
  await fundWallet(wallets.rollbackSender.id, "10.00");
  await fundWalletFromNewAsset(
    wallets.rollbackRecipient.id,
    "99999999999999999.98"
  );

  const idempotencyKey = `rollback_${randomUUID()}`;
  const response = await transfer(
    "rollbackSender",
    wallets.rollbackRecipient.id,
    "1.00",
    idempotencyKey
  );
  assert.equal(response.status, 409);
  assert.equal(response.body.message, "Destination wallet balance limit exceeded");
  assert.equal(await walletBalance("rollbackSender"), "10.00");
  assert.equal(
    await walletBalance("rollbackRecipient"),
    "99999999999999999.98"
  );
  assert.equal(
    await prisma.transaction.count({
      where: {
        initiatedByUserId: users.rollbackSender.id,
        idempotencyKey,
      },
    }),
    0
  );
});

test("transfer reversal is admin-only, idempotent, partial, and ledger-linked", async () => {
  await fundWallet(wallets.owner.id, "50.00");
  const beforeOwner = await walletBalance("owner");
  const beforeRecipient = await walletBalance("recipient");

  const created = await transfer(
    "owner",
    wallets.recipient.id,
    "10.00",
    `reversal_target_${randomUUID()}`
  );
  assert.equal(created.status, 201);
  const reference = created.body.data.transaction.reference;
  const original = await prisma.transaction.findUnique({
    where: { reference },
    select: { id: true, journalEntry: { select: { id: true } } },
  });
  const reverse = (token, key, amount) =>
    request(app)
      .post(`/api/v1/transactions/${reference}/reversals`)
      .set("Authorization", `Bearer ${tokens[token]}`)
      .set("Idempotency-Key", key)
      .send({ amount, reason: "Customer dispute" });

  const forbidden = await reverse("owner", `rev_user_${randomUUID()}`, "4.00");
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.code, "FORBIDDEN_ROLE");

  const key = `rev_${randomUUID()}`;
  const partial = await reverse("admin", key, "4.00");
  assert.equal(partial.status, 201);
  assert.equal(partial.body.data.transaction.status, "PARTIALLY_REVERSED");
  assert.equal(partial.body.data.transaction.reversedAmount, "4.00");
  assert.equal(partial.body.data.reversal.amount, "4.00");
  assert.match(partial.body.data.reversal.ledgerEntryReference, /^JRN-/);

  const replay = await reverse("admin", key, "4.00");
  assert.equal(replay.status, 200);
  assert.equal(
    replay.body.data.reversal.reference,
    partial.body.data.reversal.reference
  );
  assert.equal(
    await walletBalance("owner"),
    fromMinorUnits(toMinorUnits(beforeOwner) - 600n)
  );
  assert.equal(
    await walletBalance("recipient"),
    fromMinorUnits(toMinorUnits(beforeRecipient) + 600n)
  );

  const beyondRemaining = await reverse("admin", `rev_over_${randomUUID()}`, "7.00");
  assert.equal(beyondRemaining.status, 409);
  assert.equal(beyondRemaining.body.code, "REVERSAL_EXCEEDS_REMAINING");

  const reusedKey = await reverse("admin", key, "3.00");
  assert.equal(reusedKey.status, 409);
  assert.equal(reusedKey.body.code, "IDEMPOTENCY_KEY_REUSED");

  const restKey = `rev_rest_${randomUUID()}`;
  const rest = await reverse("admin", restKey, "6.00");
  assert.equal(rest.status, 201);
  assert.equal(rest.body.data.transaction.status, "REVERSED");
  assert.equal(rest.body.data.transaction.reversedAmount, "10.00");
  assert.equal(await walletBalance("owner"), beforeOwner);
  assert.equal(await walletBalance("recipient"), beforeRecipient);

  const restReplay = await reverse("admin", restKey, "6.00");
  assert.equal(restReplay.status, 200);
  assert.equal(
    restReplay.body.data.reversal.reference,
    rest.body.data.reversal.reference
  );
  assert.equal(restReplay.body.data.transaction.status, "REVERSED");

  const alreadyReversed = await reverse(
    "admin",
    `rev_again_${randomUUID()}`,
    "1.00"
  );
  assert.equal(alreadyReversed.status, 409);
  assert.equal(alreadyReversed.body.code, "TRANSACTION_ALREADY_REVERSED");

  const reversalEntry = await prisma.journalEntry.findUnique({
    where: { reference: rest.body.data.reversal.ledgerEntryReference },
    include: { postings: true },
  });
  assert.equal(reversalEntry.reversalOfId, original.journalEntry.id);
  const debit = reversalEntry.postings
    .filter((posting) => posting.direction === "DEBIT")
    .reduce((total, posting) => total + Number(posting.amount), 0);
  const credit = reversalEntry.postings
    .filter((posting) => posting.direction === "CREDIT")
    .reduce((total, posting) => total + Number(posting.amount), 0);
  assert.equal(debit, credit);
});

test("replaying a full-remaining reversal that omitted the amount returns the original result", async () => {
  await fundWallet(wallets.owner.id, "10.00");
  const created = await transfer(
    "owner",
    wallets.recipient.id,
    "10.00",
    `no_amount_target_${randomUUID()}`
  );
  assert.equal(created.status, 201);
  const reference = created.body.data.transaction.reference;

  const partial = await request(app)
    .post(`/api/v1/transactions/${reference}/reversals`)
    .set("Authorization", auth("admin"))
    .set("Idempotency-Key", `rev_partial_${randomUUID()}`)
    .send({ amount: "4.00", reason: "Partial dispute" });
  assert.equal(partial.status, 201);

  const restKey = `rev_rest_no_amount_${randomUUID()}`;
  const sendRest = () =>
    request(app)
      .post(`/api/v1/transactions/${reference}/reversals`)
      .set("Authorization", auth("admin"))
      .set("Idempotency-Key", restKey)
      .send({ reason: "Remaining dispute" });

  const rest = await sendRest();
  assert.equal(rest.status, 201);
  assert.equal(rest.body.data.transaction.status, "REVERSED");
  assert.equal(rest.body.data.reversal.amount, "6.00");

  const replay = await sendRest();
  assert.equal(replay.status, 200);
  assert.equal(
    replay.body.data.reversal.reference,
    rest.body.data.reversal.reference
  );
  assert.equal(replay.body.data.transaction.status, "REVERSED");
});

test("legacy transactions have no ledger entry and cannot be reversed", async () => {
  const legacy = await prisma.transaction.create({
    data: {
      initiatedByUserId: users.owner.id,
      type: "TRANSFER",
      status: "LEGACY",
      currency: "ETB",
      sourceWalletId: wallets.owner.id,
      destinationWalletId: wallets.recipient.id,
      amount: "1.00",
      idempotencyKey: `legacy_${randomUUID()}`,
      businessDate: new Date("2026-01-01T00:00:00.000Z"),
    },
  });

  const response = await request(app)
    .post(`/api/v1/transactions/${legacy.reference}/reversals`)
    .set("Authorization", `Bearer ${tokens.admin}`)
    .set("Idempotency-Key", `legacy_rev_${randomUUID()}`)
    .send({ reason: "Legacy adjustment" });
  assert.equal(response.status, 409);
  assert.equal(response.body.code, "LEGACY_TRANSACTION");
  assert.equal(
    await prisma.journalEntry.count({ where: { transactionId: legacy.id } }),
    0
  );
});

test("posted ledger records cannot be updated or deleted", async () => {
  const posting = await prisma.ledgerPosting.findFirst();
  assert.ok(posting);

  await assert.rejects(
    prisma.ledgerPosting.update({
      where: { id: posting.id },
      data: { amount: "1.00" },
    }),
    /immutable/
  );
  await assert.rejects(
    prisma.ledgerPosting.delete({ where: { id: posting.id } }),
    /immutable/
  );
  await assert.rejects(
    prisma.journalEntry.update({
      where: { id: posting.journalEntryId },
      data: { description: "tampered" },
    }),
    /immutable/
  );
});

test("OpenAPI includes wallet and transaction endpoints", async () => {
  const response = await request(app).get("/api/v1/openapi.json");
  assert.equal(response.status, 200);
  assert.ok(response.body.paths["/api/v1/wallets"]);
  assert.ok(response.body.paths["/api/v1/wallets/me"]);
  assert.ok(response.body.paths["/api/v1/transactions/transfers"]);
  assert.ok(response.body.paths["/api/v1/transactions/{reference}"]);
  assert.ok(response.body.paths["/api/v1/transactions/{reference}/reversals"]);
  assert.ok(response.body.paths["/api/v1/payments/deposits"]);
  assert.ok(response.body.paths["/api/v1/payments/withdrawals"]);
  assert.ok(response.body.paths["/api/v1/payments/withdrawals/{reference}/cancel"]);
});

test("deposit initiation is disabled without a configured provider", async () => {
  const before = await walletBalance("owner");

  const response = await request(app)
    .post("/api/v1/payments/deposits")
    .set("Authorization", auth("owner"))
    .send({ amount: "20.00" });
  assert.equal(response.status, 501);
  assert.equal(response.body.success, false);
  assert.equal(response.body.code, "PAYMENT_PROVIDER_NOT_CONFIGURED");
  assert.equal(await walletBalance("owner"), before);

  const unauthorized = await request(app)
    .post("/api/v1/payments/deposits")
    .send({ amount: "20.00" });
  assert.equal(unauthorized.status, 401);
});