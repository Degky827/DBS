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
  try {
    const paymentRows = await prisma.payment.findMany({
      where: { userId: { in: Object.values(users).map((user) => user.id) } },
      select: { id: true, reference: true },
    });
    const ids = paymentRows.map((payment) => payment.id);
    const refs = paymentRows.map((payment) => payment.reference);
    await prisma.paymentWebhookEvent.deleteMany({
      where: { paymentReference: { in: refs } },
    });
    await prisma.transaction.deleteMany({ where: { paymentId: { in: ids } } });
    await prisma.payment.deleteMany({ where: { id: { in: ids } } });
    await prisma.wallet.deleteMany({
      where: { userId: { in: Object.values(users).map((user) => user.id) } },
    });
    await prisma.devSession.deleteMany({
      where: { userId: { in: Object.values(users).map((user) => user.id) } },
    });
    await prisma.userProfile.deleteMany({
      where: { id: { in: Object.values(users).map((user) => user.id) } },
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
    prisma.transaction.findUnique({ where: { paymentId: payment.id } }),
    prisma.paymentWebhookEvent.count({ where: { paymentReference: payment.reference } }),
  ]);
  assert.equal(wallet.balance.toFixed(2), before.balance.plus("75.00").toFixed(2));
  assert.equal(transaction.type, "DEPOSIT");
  assert.equal(transaction.sourceWalletId, null);
  assert.equal(transaction.destinationWalletId, wallets.owner.id);
  assert.equal(transaction.amount.toFixed(2), "75.00");
  assert.equal(deliveryCount, 1);
});

test("pending and failed webhook events do not credit; out-of-order verification can complete", async () => {
  const { payment } = await deposit("ordering", "22.00");
  const webhook = (event) =>
    postWebhook({
      webhook_type: "payment",
      event,
      status: event === "payment.success" ? "success" : "failed",
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

test("withdrawals remain disabled and do not change the wallet", async () => {
  const before = (await prisma.wallet.findUnique({
    where: { id: wallets.owner.id },
  })).balance;
  const response = await request(app)
    .post("/api/v1/payments/withdrawals")
    .set("Authorization", `Bearer ${tokens.owner}`)
    .send({ amount: "10.00" });
  assert.equal(response.status, 501);
  assert.equal(response.body.code, "WITHDRAWALS_NOT_SUPPORTED");
  assert.equal(
    (await prisma.wallet.findUnique({ where: { id: wallets.owner.id } })).balance.toFixed(2),
    before.toFixed(2)
  );
});
