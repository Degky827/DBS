const testDatabaseUrl = process.env.WALLET_TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("WALLET_TEST_DATABASE_URL must point to an isolated test database");
}
const testDatabaseName = new URL(testDatabaseUrl).pathname.split("/").pop().split("?")[0];
if (!/_test$/i.test(testDatabaseName)) {
  throw new Error("Dispute tests only run against a database whose name ends in _test");
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

const users = {};
const tokens = {};
const wallets = {};

const createUserAndSession = async (label, role = "USER") => {
  const suffix = randomUUID().replace(/-/g, "");
  const user = await prisma.userProfile.create({
    data: {
      firstName: label,
      lastName: "Dispute Test",
      username: `${label}_${suffix.slice(0, 12)}`,
      email: `${label}_${suffix}@dispute.test`,
      phoneNumber: "+15550155",
      dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
      gender: "other",
      passwordHash: "dispute-test-only",
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
      eventRef: `test-dispute-funding:${randomUUID()}`,
      currency: "ETB",
      postings: [
        { accountCode: ledger.ACCOUNT_CODES.OPENING_BALANCE, direction: "DEBIT", amount },
        { accountCode: `WALLET:${walletId}`, direction: "CREDIT", amount },
      ],
    })
  );

const balanceOf = async (label) =>
  (await prisma.wallet.findUnique({ where: { id: wallets[label].id } })).balance.toFixed(2);

const open = (label, body = {}) =>
  request(app)
    .post("/api/v1/disputes")
    .set("Authorization", auth(label))
    .send({
      transactionReference: transferReference,
      reason: "UNAUTHORIZED",
      description: "I never authorised this payment to the vendor account.",
      ...body,
    });

const review = (label, reference, body = {}) =>
  request(app)
    .patch(`/api/v1/admin/disputes/${reference}`)
    .set("Authorization", auth(label))
    .send(body);

const eventsFor = (disputeId, type) =>
  prisma.outboxEvent.findMany({
    where: { aggregateId: disputeId, type },
    orderBy: { createdAt: "asc" },
  });

let transferReference;

before(async () => {
  kycEligibility.setKycClient({
    async getUserKycStatus() {
      return { status: "APPROVED", isApproved: true };
    },
  });
  await prisma.$connect();
  await createUserAndSession("customer");
  await createUserAndSession("merchant");
  await createUserAndSession("neighbour");
  await createUserAndSession("officer", "FINANCIAL_OFFICER");
  await createUserAndSession("admin", "ADMIN");
  await fundWallet(wallets.customer.id, "200.00");

  const transfer = await request(app)
    .post("/api/v1/transactions/transfers")
    .set("Authorization", auth("customer"))
    .set("Idempotency-Key", `dispute-${randomUUID()}`)
    .send({ destinationWalletId: wallets.merchant.id, amount: "40.00" });
  assert.equal(transfer.status, 201, JSON.stringify(transfer.body));
  transferReference = transfer.body.data.transaction.reference;
});

after(async () => {
  kycEligibility.setKycClient(null);
  await prisma.$disconnect();
});

test("submitting a dispute requires authentication", async () => {
  const anonymous = await request(app).post("/api/v1/disputes").send({
    transactionReference: transferReference,
    reason: "UNAUTHORIZED",
    description: "This payment was not authorised by me at all.",
  });
  assert.equal(anonymous.status, 401);
});

test("disputes are validated before they are stored", async () => {
  const short = await open("customer", { description: "too short" });
  assert.equal(short.status, 400);
  assert.match(short.body.errors.description, /at least 20/);

  const reason = await open("customer", { reason: "FRAUDULENT" });
  assert.equal(reason.status, 400);
  assert.ok(reason.body.errors.reason);

  const unknownTransaction = await open("customer", { transactionReference: randomUUID() });
  assert.equal(unknownTransaction.status, 404);
  assert.equal(unknownTransaction.body.code, "TRANSACTION_NOT_FOUND");

  const extra = await open("customer", { refund: true });
  assert.equal(extra.status, 400);
});

test("only the participants of a transaction can dispute it", async () => {
  const outsider = await open("neighbour");
  assert.equal(outsider.status, 404);
  assert.equal(outsider.body.code, "TRANSACTION_NOT_FOUND");

  const merchant = await open("merchant", { reason: "NOT_RECEIVED" });
  assert.equal(merchant.status, 201);
  assert.equal(merchant.body.data.dispute.customer === undefined, true);
});

test("opening a dispute records the event and publishes one outbox row", async () => {
  const created = await open("customer");
  assert.equal(created.status, 201);

  const dispute = created.body.data.dispute;
  assert.equal(dispute.status, "OPEN");
  assert.equal(dispute.reason, "UNAUTHORIZED");
  assert.match(dispute.reference, /^[0-9a-f-]{36}$/);
  assert.equal(dispute.transaction.amount, "40.00");
  assert.equal(dispute.transaction.reference, transferReference);
  assert.deepEqual(
    dispute.events.map((event) => event.type),
    ["OPENED"]
  );

  const published = await eventsFor(dispute.id, "dispute.opened");
  assert.equal(published.length, 1);
  assert.equal(published[0].aggregateType, "Dispute");
  assert.equal(published[0].payload.transactionReference, transferReference);
  assert.equal(published[0].payload.email, users.customer.email);
  assert.equal(published[0].payload.amount, "40.00");

  const duplicate = await open("customer");
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, "DISPUTE_ALREADY_OPEN");
  assert.equal(duplicate.body.errors.reference, dispute.reference);
});

test("customers see only their own disputes", async () => {
  const mine = await request(app).get("/api/v1/disputes").set("Authorization", auth("customer"));
  assert.equal(mine.status, 200);
  const references = mine.body.data.disputes.map((dispute) => dispute.reference);
  assert.equal(references.length, 1);

  const other = await request(app)
    .get(`/api/v1/disputes/${references[0]}`)
    .set("Authorization", auth("neighbour"));
  assert.equal(other.status, 404);
  assert.equal(other.body.code, "DISPUTE_NOT_FOUND");

  const own = await request(app)
    .get(`/api/v1/disputes/${references[0]}`)
    .set("Authorization", auth("customer"));
  assert.equal(own.status, 200);
  assert.equal(own.body.data.dispute.reference, references[0]);

  const filtered = await request(app)
    .get("/api/v1/disputes?status=RESOLVED&limit=1")
    .set("Authorization", auth("customer"));
  assert.equal(filtered.status, 200);
  assert.deepEqual(filtered.body.data.disputes, []);

  const badQuery = await request(app)
    .get("/api/v1/disputes?status=CLOSED")
    .set("Authorization", auth("customer"));
  assert.equal(badQuery.status, 400);

  const shortSearch = await request(app)
    .get("/api/v1/disputes?q=ab")
    .set("Authorization", auth("customer"));
  assert.equal(shortSearch.status, 400);
});

test("review queues are restricted to staff", async () => {
  const asCustomer = await request(app)
    .get("/api/v1/admin/disputes")
    .set("Authorization", auth("customer"));
  assert.equal(asCustomer.status, 403);

  const asMerchantRole = await request(app)
    .get("/api/v1/admin/disputes")
    .set("Authorization", auth("merchant"));
  assert.equal(asMerchantRole.status, 403);

  const officer = await request(app)
    .get("/api/v1/admin/disputes?limit=100")
    .set("Authorization", auth("officer"));
  assert.equal(officer.status, 200);
  assert.ok(officer.body.data.disputes.length >= 2);
  const customerRow = officer.body.data.disputes.find(
    (dispute) => dispute.reason === "UNAUTHORIZED" && dispute.status === "OPEN"
  );
  assert.equal(customerRow.customer.email, users.customer.email);
  assert.equal(customerRow.customer.name, "customer Dispute Test");

  const searched = await request(app)
    .get(`/api/v1/admin/disputes?q=${encodeURIComponent(transferReference)}`)
    .set("Authorization", auth("admin"));
  assert.equal(searched.status, 200);
  assert.ok(searched.body.data.disputes.length >= 1);
});

test("staff transitions work through the documented lifecycle", async () => {
  const list = await request(app).get("/api/v1/disputes").set("Authorization", auth("customer"));
  const dispute = list.body.data.disputes[0];

  const noResolution = await review("officer", dispute.reference, { status: "RESOLVED" });
  assert.equal(noResolution.status, 400);
  assert.match(noResolution.body.errors.resolution, /required/);

  const negative = await review("officer", dispute.reference, {
    status: "UNDER_REVIEW",
    resolvedAmount: "-1.00",
  });
  assert.equal(negative.status, 400);

  const assigned = await review("officer", dispute.reference, {
    status: "UNDER_REVIEW",
    assignedTo: "ops-queue-1",
  });
  assert.equal(assigned.status, 200);
  assert.equal(assigned.body.data.dispute.status, "UNDER_REVIEW");
  assert.equal(assigned.body.data.dispute.assignedTo, "ops-queue-1");
  assert.equal(assigned.body.data.dispute.events.at(-1).type, "STATUS_UNDER_REVIEW");

  const reopen = await review("officer", dispute.reference, { status: "OPEN" });
  assert.equal(reopen.status, 400);
  assert.ok(reopen.body.errors.status);

  const customerPatch = await review("customer", dispute.reference, { status: "UNDER_REVIEW" });
  assert.equal(customerPatch.status, 403);

  const balances = { customer: await balanceOf("customer"), merchant: await balanceOf("merchant") };

  const resolved = await review("officer", dispute.reference, {
    status: "RESOLVED",
    resolution:
      "Merchant confirmed the vendor was never engaged; goodwill credit handled out of band.",
    resolvedAmount: "20.00",
  });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.data.dispute.status, "RESOLVED");
  assert.equal(resolved.body.data.dispute.resolvedAmount, "20.00");
  assert.deepEqual(
    resolved.body.data.dispute.events.map((event) => event.type),
    ["OPENED", "STATUS_UNDER_REVIEW", "STATUS_RESOLVED"]
  );

  assert.equal(await balanceOf("customer"), balances.customer);
  assert.equal(await balanceOf("merchant"), balances.merchant);

  const afterClose = await review("officer", dispute.reference, { status: "UNDER_REVIEW" });
  assert.equal(afterClose.status, 409);
  assert.equal(afterClose.body.code, "INVALID_DISPUTE_TRANSITION");

  const updatedEvents = await eventsFor(dispute.id, "dispute.updated");
  assert.deepEqual(
    updatedEvents.map((event) => event.payload.status),
    ["UNDER_REVIEW", "RESOLVED"]
  );

  const detail = await request(app)
    .get(`/api/v1/admin/disputes/${dispute.reference}`)
    .set("Authorization", auth("admin"));
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.dispute.resolution.startsWith("Merchant confirmed"), true);
  assert.equal(detail.body.data.dispute.events.length, 3);

  const missing = await review("admin", randomUUID(), { status: "UNDER_REVIEW" });
  assert.equal(missing.status, 404);
});

test("a rejected dispute is terminal for the customer", async () => {
  const list = await request(app).get("/api/v1/disputes").set("Authorization", auth("merchant"));
  const dispute = list.body.data.disputes[0];

  const rejected = await review("admin", dispute.reference, {
    status: "REJECTED",
    resolution: "The transfer matches the customer's own confirmation message.",
  });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.data.dispute.status, "REJECTED");
  assert.equal(rejected.body.data.dispute.resolvedAmount, null);

  const reopen = await review("admin", dispute.reference, {
    status: "UNDER_REVIEW",
    resolution: "try again",
  });
  assert.equal(reopen.status, 409);

  const mine = await request(app)
    .get(`/api/v1/disputes/${dispute.reference}`)
    .set("Authorization", auth("merchant"));
  assert.equal(mine.status, 200);
  assert.equal(mine.body.data.dispute.status, "REJECTED");
});
