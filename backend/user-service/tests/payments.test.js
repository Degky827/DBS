const testDatabaseUrl = process.env.WALLET_TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("WALLET_TEST_DATABASE_URL must point to an isolated test database");
}
const testDatabaseName = new URL(testDatabaseUrl).pathname.split("/").pop();
if (!/_test$/i.test(testDatabaseName)) {
  throw new Error("Payment tests only run against a database whose name ends in _test");
}
process.env.DATABASE_URL = testDatabaseUrl;
process.env.NODE_ENV = "test";
process.env.AUTH_MODE = "dev";
process.env.DEV_API_KEY = "";
process.env.ENABLE_API_DOCS = "true";
process.env.AUTH_RATE_LIMIT_MAX = "1000";
process.env.RATE_LIMIT_MAX = "10000";

const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const request = require("supertest");
const app = require("../src/app");
const prisma = require("../src/config/database");
const { setCustomPaymentsService } = require("../src/modules/payments/payments.routes");
const PaymentsService = require("../src/modules/payments/payments.service");
const {
  reconcilePendingPayments,
} = require("../src/modules/payments/reconciliation.service");
const ledger = require("../src/modules/ledger/ledger.service");
const kycEligibility = require("../src/services/kycEligibility");
const { hashDevSessionToken } = require("../src/utils/token.util");

const WEBHOOK_SECRET = "chapa-test-webhook-secret-for-tests";
const providers = {};
const users = {};
const wallets = {};
const tokens = {};
let paymentsService;

const createMockProvider = () => ({
  initiationCalls: [],
  verificationCalls: [],
  statuses: new Map(),

  async initiate(params) {
    this.initiationCalls.push(params);
    return {
      checkoutUrl: `https://checkout.chapa.global/session/${params.txRef}`,
      txRef: params.txRef,
      merchantReference: params.txRef,
      providerRef: `CHAPA-${params.txRef}`,
    };
  },

  async getStatus(reference) {
    this.verificationCalls.push(reference);
    return (
      this.statuses.get(reference) || {
        status: "PENDING",
        rawStatus: "PENDING",
        merchantReference: reference,
        providerRef: `CHAPA-${reference}`,
        amount: "20.00",
        currency: "ETB",
      }
    );
  },

  verifyWebhook(req) {
    if (!Buffer.isBuffer(req.rawBody)) return false;
    const signature = req.headers["x-chapa-signature"];
    if (typeof signature !== "string" || !/^[a-f0-9]{64}$/i.test(signature)) return false;
    const expected = crypto
      .createHmac("sha256", WEBHOOK_SECRET)
      .update(req.rawBody)
      .digest();
    const actual = Buffer.from(signature, "hex");
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  },
});

const sign = (rawBody) =>
  crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");

const approveKyc = () =>
  kycEligibility.setKycClient({
    async getUserKycStatus() {
      return { status: "APPROVED", isApproved: true };
    },
  });

const fundWallet = async (walletId, amount) =>
  prisma.$transaction((tx) =>
    ledger.postEntry({
      tx,
      eventType: "TEST_FUNDING",
      eventRef: `test-funding:${crypto.randomUUID()}`,
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

const deposit = async (label, amount = "20.00") => {
  const key = `${label}_${crypto.randomUUID()}`;
  const response = await request(app)
    .post("/api/v1/payments/deposits")
    .set("Authorization", `Bearer ${tokens.owner}`)
    .set("Idempotency-Key", key)
    .send({ amount });
  assert.equal(response.status, 201);
  return { payment: response.body.data.payment, key };
};

const postWebhook = (payload, rawBody = JSON.stringify(payload), signature = sign(rawBody)) =>
  request(app)
    .post("/api/v1/payments/webhook")
    .set("x-chapa-signature", signature)
    .set("Content-Type", "application/json")
    .send(rawBody);

const providerStatus = (reference, status, amount, currency = "ETB") => {
  providers.main.statuses.set(reference, {
    status,
    rawStatus: status,
    merchantReference: reference,
    providerRef: `CHAPA-${reference}`,
    amount,
    currency,
  });
};

before(async () => {
  approveKyc();
  await prisma.$connect();
  const suffix = crypto.randomUUID().replace(/-/g, "");
  for (const role of ["owner", "outsider"]) {
    const user = await prisma.userProfile.create({
      data: {
        firstName: role,
        lastName: "Payment Test",
        username: `${role}_${suffix}`,
        email: `${role}_${suffix}@payment.test`,
        phoneNumber: "+251911223344",
        dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
        gender: "other",
        passwordHash: "payment-test-only",
      },
    });
    users[role] = user;
    tokens[role] = crypto.randomBytes(32).toString("hex");
    await prisma.devSession.create({
      data: {
        userId: user.id,
        tokenHash: hashDevSessionToken(tokens[role]),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    wallets[role] = await prisma.wallet.create({
      data: { userId: user.id, currency: "ETB", isActive: true },
    });
  }

  providers.main = createMockProvider();
  paymentsService = new PaymentsService(providers.main, prisma);
  setCustomPaymentsService(paymentsService);
});

after(async () => {
  kycEligibility.setKycClient(null);
  try {
    // Ledger entries are immutable by design, so financial fixtures remain in
    // the disposable test database; sessions are removed for repeatability.
    await prisma.devSession.deleteMany({
      where: { userId: { in: Object.values(users).map((user) => user.id) } },
    });
  } finally {
    await prisma.$disconnect();
  }
});

test("deposit initialization is ETB idempotent and uses one persistent merchant reference", async () => {
  const key = `deposit_${crypto.randomUUID()}`;
  const initiate = () =>
    request(app)
      .post("/api/v1/payments/deposits")
      .set("Authorization", `Bearer ${tokens.owner}`)
      .set("Idempotency-Key", key)
      .send({ amount: "50.25" });
  const first = await initiate();
  assert.equal(first.status, 201);
  assert.equal(first.body.data.payment.status, "PENDING");
  assert.equal(first.body.data.payment.amount, "50.25");
  assert.equal(first.body.data.payment.currency, "ETB");
  assert.ok(first.body.data.payment.checkoutUrl.startsWith("https://"));
  assert.ok(first.body.data.payment.reference.length <= 20);
  assert.equal(providers.main.initiationCalls.at(-1).amount, "50.25");

  const replay = await initiate();
  assert.equal(replay.status, 200);
  assert.equal(replay.body.data.payment.reference, first.body.data.payment.reference);

  const conflict = await request(app)
    .post("/api/v1/payments/deposits")
    .set("Authorization", `Bearer ${tokens.owner}`)
    .set("Idempotency-Key", key)
    .send({ amount: "51.25" });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, "IDEMPOTENCY_KEY_REUSED");
});

test("deposit initiation and return verification require KYC approval", async () => {
  const balanceBefore = (
    await prisma.wallet.findUnique({ where: { id: wallets.owner.id } })
  ).balance;
  const initiationsBefore = providers.main.initiationCalls.length;
  const verificationsBefore = providers.main.verificationCalls.length;
  const paymentsBefore = await prisma.payment.count({
    where: { userId: users.owner.id },
  });

  kycEligibility.setKycClient({
    async getUserKycStatus() {
      return { status: "PENDING_REVIEW", isApproved: false };
    },
  });

  try {
    const initiate = await request(app)
      .post("/api/v1/payments/deposits")
      .set("Authorization", `Bearer ${tokens.owner}`)
      .set("Idempotency-Key", `kyc_rejected_${crypto.randomUUID()}`)
      .send({ amount: "20.00" });
    assert.equal(initiate.status, 403);
    assert.equal(initiate.body.code, "KYC_NOT_APPROVED");

    const verify = await request(app)
      .get("/api/v1/payments/deposits/not-created/verify")
      .set("Authorization", `Bearer ${tokens.owner}`);
    assert.equal(verify.status, 403);
    assert.equal(verify.body.code, "KYC_NOT_APPROVED");
  } finally {
    approveKyc();
  }

  assert.equal(providers.main.initiationCalls.length, initiationsBefore);
  assert.equal(providers.main.verificationCalls.length, verificationsBefore);
  assert.equal(
    await prisma.payment.count({ where: { userId: users.owner.id } }),
    paymentsBefore
  );
  assert.equal(
    (
      await prisma.wallet.findUnique({ where: { id: wallets.owner.id } })
    ).balance.toFixed(2),
    balanceBefore.toFixed(2)
  );
});

test("successful webhook credits once and persists a linked DEPOSIT transaction", async () => {
  const { payment } = await deposit("success", "75.00");
  providerStatus(payment.reference, "SUCCESS", "75.00");
  const before = await prisma.wallet.findUnique({ where: { id: wallets.owner.id } });
  const rawBody = JSON.stringify({
    webhook_type: "payment",
    event: "payment.success",
    status: "success",
    mode: "test",
    merchant_reference: payment.reference,
  });

  const first = await postWebhook(JSON.parse(rawBody), rawBody);
  assert.equal(first.status, 200);
  assert.equal(first.body.data.payment.status, "COMPLETED");
  const duplicate = await postWebhook(JSON.parse(rawBody), rawBody);
  assert.equal(duplicate.status, 200);

  const [wallet, transaction, deliveryCount] = await Promise.all([
    prisma.wallet.findUnique({ where: { id: wallets.owner.id } }),
    prisma.transaction.findUnique({
      where: { paymentId: payment.id },
      include: { journalEntry: { include: { postings: true } } },
    }),
    prisma.paymentWebhookEvent.count({ where: { paymentReference: payment.reference } }),
  ]);
  assert.equal(wallet.balance.toFixed(2), before.balance.plus("75.00").toFixed(2));
  assert.equal(transaction.type, "DEPOSIT");
  assert.equal(transaction.status, "POSTED");
  assert.equal(transaction.currency, "ETB");
  assert.equal(transaction.sourceWalletId, null);
  assert.equal(transaction.destinationWalletId, wallets.owner.id);
  assert.equal(transaction.amount.toFixed(2), "75.00");
  assert.equal(transaction.feeAmount.toFixed(2), "0.00");
  assert.equal(deliveryCount, 1);

  const ledgerPostings = transaction.journalEntry.postings;
  const debits = ledgerPostings
    .filter((posting) => posting.direction === "DEBIT")
    .reduce((total, posting) => total + Number(posting.amount), 0);
  const credits = ledgerPostings
    .filter((posting) => posting.direction === "CREDIT")
    .reduce((total, posting) => total + Number(posting.amount), 0);
  assert.equal(debits, 75);
  assert.equal(credits, 75);
  assert.equal(
    await prisma.ledgerAccount.findUnique({
      where: { walletId: wallets.owner.id },
    }).then((account) => account.balance.toFixed(2)),
    wallet.balance.toFixed(2)
  );
});

test("webhook signature verification still sees the raw body when a query string is present", async () => {
  const { payment } = await deposit("query", "12.00");
  providerStatus(payment.reference, "SUCCESS", "12.00");
  const rawBody = JSON.stringify({
    webhook_type: "payment",
    event: "payment.success",
    status: "success",
    mode: "test",
    merchant_reference: payment.reference,
  });

  const response = await request(app)
    .post("/api/v1/payments/webhook?source=chapa")
    .set("x-chapa-signature", sign(rawBody))
    .set("Content-Type", "application/json")
    .send(rawBody);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.payment.status, "COMPLETED");
});

test("pending and failed webhook events do not credit; out-of-order verification can complete", async () => {
  const { payment } = await deposit("ordering", "22.00");
  const webhook = (event) =>
    postWebhook({
      webhook_type: "payment",
      event,
      status: event.replace("payment.", ""),
      mode: "test",
      merchant_reference: payment.reference,
    });
  const initialBalance = (await prisma.wallet.findUnique({
    where: { id: wallets.owner.id },
  })).balance;

  providerStatus(payment.reference, "PENDING", "22.00");
  assert.equal((await webhook("payment.success")).body.data.payment.status, "PENDING");

  providerStatus(payment.reference, "FAILED", "22.00");
  assert.equal((await webhook("payment.failed")).body.data.payment.status, "FAILED");

  providerStatus(payment.reference, "PENDING", "22.00");
  assert.equal((await webhook("payment.incomplete")).body.data.payment.status, "FAILED");

  providerStatus(payment.reference, "SUCCESS", "22.00");
  assert.equal((await webhook("payment.success")).body.data.payment.status, "COMPLETED");
  const finalBalance = (await prisma.wallet.findUnique({
    where: { id: wallets.owner.id },
  })).balance;
  assert.equal(finalBalance.toFixed(2), initialBalance.plus("22.00").toFixed(2));
});

test("forged webhook is rejected before provider verification", async () => {
  const callsBefore = providers.main.verificationCalls.length;
  const rawBody = JSON.stringify({
    webhook_type: "payment",
    event: "payment.success",
    status: "success",
    merchant_reference: "not-a-payment",
  });
  const response = await postWebhook({}, rawBody, "0".repeat(64));
  assert.equal(response.status, 400);
  assert.equal(response.body.code, "INVALID_SIGNATURE");
  assert.equal(providers.main.verificationCalls.length, callsBefore);
});

test("provider amount or currency mismatch is durably rejected without wallet credit", async () => {
  const { payment } = await deposit("mismatch", "100.00");
  providerStatus(payment.reference, "SUCCESS", "10.00");
  const balanceBefore = (await prisma.wallet.findUnique({
    where: { id: wallets.owner.id },
  })).balance;

  const mismatch = await postWebhook({
    webhook_type: "payment",
    event: "payment.success",
    status: "success",
    mode: "test",
    merchant_reference: payment.reference,
  });
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.body.code, "PAYMENT_AMOUNT_MISMATCH");
  const failed = await prisma.payment.findUnique({ where: { id: payment.id } });
  assert.equal(failed.status, "FAILED");
  assert.match(failed.failureReason, /Amount mismatch/);
  assert.equal(
    (await prisma.wallet.findUnique({ where: { id: wallets.owner.id } })).balance.toFixed(2),
    balanceBefore.toFixed(2)
  );
  assert.equal(
    await prisma.transaction.count({ where: { paymentId: payment.id } }),
    0
  );
});

test("verified return is authenticated and scoped to the payment owner", async () => {
  const { payment } = await deposit("return", "30.00");
  providerStatus(payment.reference, "SUCCESS", "30.00");

  const unauthorized = await request(app)
    .get(`/api/v1/payments/deposits/${payment.reference}/verify`)
    .set("Authorization", `Bearer ${tokens.outsider}`);
  assert.equal(unauthorized.status, 404);
  assert.equal(unauthorized.body.code, "PAYMENT_NOT_FOUND");

  const verified = await request(app)
    .get(`/api/v1/payments/deposits/${payment.reference}/verify`)
    .set("Authorization", `Bearer ${tokens.owner}`);
  assert.equal(verified.status, 200);
  assert.equal(verified.body.data.payment.status, "COMPLETED");
});

test("concurrent duplicate webhook deliveries credit exactly once", async () => {
  const { payment } = await deposit("concurrent", "40.00");
  providerStatus(payment.reference, "SUCCESS", "40.00");
  const before = (await prisma.wallet.findUnique({
    where: { id: wallets.owner.id },
  })).balance;
  const payload = {
    webhook_type: "payment",
    event: "payment.success",
    status: "success",
    mode: "test",
    merchant_reference: payment.reference,
  };
  const rawBody = JSON.stringify(payload);
  const signature = sign(rawBody);
  const send = () => postWebhook(payload, rawBody, signature);
  const results = await Promise.all([send(), send()]);
  assert.deepEqual(results.map((result) => result.status), [200, 200]);
  const after = (await prisma.wallet.findUnique({
    where: { id: wallets.owner.id },
  })).balance;
  assert.equal(after.toFixed(2), before.plus("40.00").toFixed(2));
  assert.equal(
    await prisma.transaction.count({ where: { paymentId: payment.id } }),
    1
  );
});

test("invalid minimum amount and unrecognized webhook mode are rejected", async () => {
  const tooSmall = await request(app)
    .post("/api/v1/payments/deposits")
    .set("Authorization", `Bearer ${tokens.owner}`)
    .set("Idempotency-Key", `min_${crypto.randomUUID()}`)
    .send({ amount: "0.99" });
  assert.equal(tooSmall.status, 400);

  const rawBody = JSON.stringify({
    webhook_type: "payment",
    event: "payment.success",
    status: "success",
    mode: "live",
    merchant_reference: "reference",
  });
  const invalidMode = await postWebhook(
    JSON.parse(rawBody),
    rawBody,
    sign(rawBody)
  );
  assert.equal(invalidMode.status, 400);
  assert.equal(invalidMode.body.code, "INVALID_WEBHOOK_EVENT");
});

test("reconciliation resolves a stale provider success exactly once", async () => {
  const { payment } = await deposit("reconcile", "60.00");
  providerStatus(payment.reference, "SUCCESS", "60.00");
  await prisma.payment.update({
    where: { id: payment.id },
    data: { createdAt: new Date(Date.now() - 60 * 60 * 1000) },
  });
  const before = (await prisma.wallet.findUnique({
    where: { id: wallets.owner.id },
  })).balance;

  const summary = await reconcilePendingPayments({
    olderThanMinutes: 15,
    limit: 50,
    trigger: "TEST",
  });
  const result = summary.results.find(
    (entry) => entry.paymentReference === payment.reference
  );
  assert.ok(result);
  assert.equal(result.outcome, "MATCHED");

  const completed = await prisma.payment.findUnique({
    where: { id: payment.id },
  });
  assert.equal(completed.status, "COMPLETED");
  const wallet = await prisma.wallet.findUnique({
    where: { id: wallets.owner.id },
  });
  assert.equal(wallet.balance.toFixed(2), before.plus("60.00").toFixed(2));
  assert.equal(
    await prisma.transaction.count({ where: { paymentId: payment.id } }),
    1
  );

  const record = await prisma.paymentReconciliationRecord.findFirst({
    where: { paymentId: payment.id },
    orderBy: { createdAt: "desc" },
  });
  assert.equal(record.outcome, "MATCHED");
  assert.equal(record.providerStatus, "SUCCESS");
  assert.equal(record.providerAmount.toFixed(2), "60.00");

  const second = await reconcilePendingPayments({
    olderThanMinutes: 15,
    limit: 50,
    trigger: "TEST",
  });
  assert.ok(
    !second.results.some(
      (entry) => entry.paymentReference === payment.reference
    )
  );
});

test("reconciliation records an amount mismatch without crediting the wallet", async () => {
  const { payment } = await deposit("recon_mismatch", "100.00");
  providerStatus(payment.reference, "SUCCESS", "10.00");
  await prisma.payment.update({
    where: { id: payment.id },
    data: { createdAt: new Date(Date.now() - 60 * 60 * 1000) },
  });
  const before = (await prisma.wallet.findUnique({
    where: { id: wallets.owner.id },
  })).balance;

  const summary = await reconcilePendingPayments({
    olderThanMinutes: 15,
    limit: 50,
    trigger: "TEST",
  });
  const result = summary.results.find(
    (entry) => entry.paymentReference === payment.reference
  );
  assert.ok(result);
  assert.equal(result.outcome, "MISMATCH");
  assert.equal(result.errorCode, "PAYMENT_AMOUNT_MISMATCH");

  const failed = await prisma.payment.findUnique({
    where: { id: payment.id },
  });
  assert.equal(failed.status, "FAILED");
  assert.equal(
    (await prisma.wallet.findUnique({ where: { id: wallets.owner.id } })).balance.toFixed(2),
    before.toFixed(2)
  );
  assert.equal(
    await prisma.transaction.count({ where: { paymentId: payment.id } }),
    0
  );
  const record = await prisma.paymentReconciliationRecord.findFirst({
    where: { paymentId: payment.id },
    orderBy: { createdAt: "desc" },
  });
  assert.equal(record.outcome, "MISMATCH");
  assert.match(record.details, /amount mismatch/i);
});

test("a local ledger failure leaves the payment pending for a later verification", async () => {
  const { payment } = await deposit("db_failure", "33.00");
  providerStatus(payment.reference, "SUCCESS", "33.00");
  const before = (await prisma.wallet.findUnique({
    where: { id: wallets.owner.id },
  })).balance;
  const account = await prisma.ledgerAccount.findUnique({
    where: { walletId: wallets.owner.id },
  });

  await prisma.ledgerAccount.update({
    where: { id: account.id },
    data: { isActive: false },
  });

  let webhook;
  try {
    webhook = await postWebhook({
      webhook_type: "payment",
      event: "payment.success",
      status: "success",
      mode: "test",
      merchant_reference: payment.reference,
    });
  } finally {
    await prisma.ledgerAccount.update({
      where: { id: account.id },
      data: { isActive: true },
    });
  }

  assert.equal(webhook.status, 409);
  assert.equal(webhook.body.code, "LEDGER_ACCOUNT_INACTIVE");
  const stillPending = await prisma.payment.findUnique({
    where: { id: payment.id },
  });
  assert.equal(stillPending.status, "PENDING");
  assert.equal(
    await prisma.transaction.count({ where: { paymentId: payment.id } }),
    0
  );
  assert.equal(
    await prisma.paymentWebhookEvent.count({
      where: { paymentReference: payment.reference },
    }),
    0
  );
  assert.equal(
    (await prisma.wallet.findUnique({ where: { id: wallets.owner.id } })).balance.toFixed(2),
    before.toFixed(2)
  );

  const verified = await request(app)
    .get(`/api/v1/payments/deposits/${payment.reference}/verify`)
    .set("Authorization", `Bearer ${tokens.owner}`);
  assert.equal(verified.status, 200);
  assert.equal(verified.body.data.payment.status, "COMPLETED");
  assert.equal(
    (await prisma.wallet.findUnique({ where: { id: wallets.owner.id } })).balance.toFixed(2),
    before.plus("33.00").toFixed(2)
  );
});

test("withdrawals reserve funds internally and can only be cancelled, never paid out", async () => {
  await fundWallet(wallets.owner.id, "500.00");
  const before = (await prisma.wallet.findUnique({
    where: { id: wallets.owner.id },
  })).balance;
  const reservedBefore = (await prisma.ledgerAccount.findUnique({
    where: { code: "PLATFORM:WITHDRAWAL_RESERVED" },
  })).balance;
  const key = `withdraw_${crypto.randomUUID()}`;
  const create = () =>
    request(app)
      .post("/api/v1/payments/withdrawals")
      .set("Authorization", `Bearer ${tokens.owner}`)
      .set("Idempotency-Key", key)
      .send({ amount: "120.00" });

  const reserved = await create();
  assert.equal(reserved.status, 201);
  assert.equal(reserved.body.data.withdrawal.status, "PENDING");
  assert.equal(reserved.body.data.withdrawal.amount, "120.00");
  assert.equal(reserved.body.data.withdrawal.currency, "ETB");
  assert.match(reserved.body.data.withdrawal.ledgerEntryReference, /^JRN-/);

  const walletAfterReserve = await prisma.wallet.findUnique({
    where: { id: wallets.owner.id },
  });
  assert.equal(walletAfterReserve.balance.toFixed(2), before.minus("120.00").toFixed(2));
  const reservedAfter = (await prisma.ledgerAccount.findUnique({
    where: { code: "PLATFORM:WITHDRAWAL_RESERVED" },
  })).balance;
  assert.equal(
    reservedAfter.toFixed(2),
    reservedBefore.plus("120.00").toFixed(2)
  );

  const replay = await create();
  assert.equal(replay.status, 200);
  assert.equal(
    replay.body.data.withdrawal.reference,
    reserved.body.data.withdrawal.reference
  );
  assert.equal(
    (await prisma.wallet.findUnique({ where: { id: wallets.owner.id } })).balance.toFixed(2),
    before.minus("120.00").toFixed(2)
  );

  const differentAmount = await request(app)
    .post("/api/v1/payments/withdrawals")
    .set("Authorization", `Bearer ${tokens.owner}`)
    .set("Idempotency-Key", key)
    .send({ amount: "121.00" });
  assert.equal(differentAmount.status, 409);
  assert.equal(differentAmount.body.code, "IDEMPOTENCY_KEY_REUSED");

  const reference = reserved.body.data.withdrawal.reference;
  const foreignRead = await request(app)
    .get(`/api/v1/payments/withdrawals/${reference}`)
    .set("Authorization", `Bearer ${tokens.outsider}`);
  assert.equal(foreignRead.status, 404);
  const foreignCancel = await request(app)
    .post(`/api/v1/payments/withdrawals/${reference}/cancel`)
    .set("Authorization", `Bearer ${tokens.outsider}`)
    .send({});
  assert.equal(foreignCancel.status, 404);

  const cancelled = await request(app)
    .post(`/api/v1/payments/withdrawals/${reference}/cancel`)
    .set("Authorization", `Bearer ${tokens.owner}`)
    .send({});
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.data.withdrawal.status, "CANCELLED");
  assert.match(cancelled.body.data.withdrawal.ledgerEntryReference, /^JRN-/);
  assert.equal(
    (await prisma.wallet.findUnique({ where: { id: wallets.owner.id } })).balance.toFixed(2),
    before.toFixed(2)
  );
  assert.equal(
    (await prisma.ledgerAccount.findUnique({
      where: { code: "PLATFORM:WITHDRAWAL_RESERVED" },
    })).balance.toFixed(2),
    reservedBefore.toFixed(2)
  );

  const cancelAgain = await request(app)
    .post(`/api/v1/payments/withdrawals/${reference}/cancel`)
    .set("Authorization", `Bearer ${tokens.owner}`)
    .send({});
  assert.equal(cancelAgain.status, 200);
  assert.equal(cancelAgain.body.data.withdrawal.status, "CANCELLED");
  assert.match(cancelAgain.body.data.withdrawal.ledgerEntryReference, /^JRN-/);

  const tooSmall = await request(app)
    .post("/api/v1/payments/withdrawals")
    .set("Authorization", `Bearer ${tokens.owner}`)
    .set("Idempotency-Key", `withdraw_small_${crypto.randomUUID()}`)
    .send({ amount: "0.50" });
  assert.equal(tooSmall.status, 400);

  const tooLarge = await request(app)
    .post("/api/v1/payments/withdrawals")
    .set("Authorization", `Bearer ${tokens.owner}`)
    .set("Idempotency-Key", `withdraw_large_${crypto.randomUUID()}`)
    .send({ amount: "5000.00" });
  assert.equal(tooLarge.status, 409);
  assert.equal(tooLarge.body.code, "INSUFFICIENT_FUNDS");
  assert.equal(
    await prisma.withdrawal.count({
      where: { userId: users.owner.id, status: "PENDING" },
    }),
    0
  );
});
