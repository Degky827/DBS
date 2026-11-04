const testDatabaseUrl = process.env.WALLET_TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("WALLET_TEST_DATABASE_URL must point to an isolated test database");
}
const testDatabaseName = new URL(testDatabaseUrl).pathname.split("/").pop().split("?")[0];
if (!/_test$/i.test(testDatabaseName)) {
  throw new Error("Statement tests only run against a database whose name ends in _test");
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
const { Prisma } = require("@prisma/client");
const request = require("supertest");
const app = require("../src/app");
const prisma = require("../src/config/database");
const kycEligibility = require("../src/services/kycEligibility");
const ledger = require("../src/modules/ledger/ledger.service");
const statements = require("../src/modules/statements/statements.service");

const users = {};
const tokens = {};
const wallets = {};

const createUserAndSession = async (label, role = "USER") => {
  const suffix = randomUUID().replace(/-/g, "");
  const user = await prisma.userProfile.create({
    data: {
      firstName: label,
      lastName: "Statement Test",
      username: `${label}_${suffix.slice(0, 12)}`,
      email: `${label}_${suffix}@statement.test`,
      phoneNumber: "+15550166",
      dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
      gender: "other",
      passwordHash: "statement-test-only",
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
      eventRef: `test-statement-funding:${randomUUID()}`,
      currency: "ETB",
      postings: [
        { accountCode: ledger.ACCOUNT_CODES.OPENING_BALANCE, direction: "DEBIT", amount },
        { accountCode: `WALLET:${walletId}`, direction: "CREDIT", amount },
      ],
    })
  );

const transfer = async (label, destinationWalletId, amount) => {
  const response = await request(app)
    .post("/api/v1/transactions/transfers")
    .set("Authorization", auth(label))
    .set("Idempotency-Key", `statement-${randomUUID()}`)
    .send({ destinationWalletId, amount });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data.transaction.reference;
};

const dayOffset = (days) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

// The current balance is only reachable from a statement when rows posted after
// the requested window are subtracted again.
const getStatement = (label, query = `from=${dayOffset(0)}&to=${dayOffset(1)}`) =>
  request(app).get(`/api/v1/statements?${query}`).set("Authorization", auth(label));

const decimal = (value) => new Prisma.Decimal(value);

let outgoingReference;
let incomingReference;

before(async () => {
  kycEligibility.setKycClient({
    async getUserKycStatus() {
      return { status: "APPROVED", isApproved: true };
    },
  });
  await prisma.$connect();
  await createUserAndSession("payer");
  await createUserAndSession("payee");
  await createUserAndSession("quiet");
  await fundWallet(wallets.payer.id, "300.00");
  outgoingReference = await transfer("payer", wallets.payee.id, "50.00");
  incomingReference = await transfer("payee", wallets.payer.id, "20.00");
});

after(async () => {
  kycEligibility.setKycClient(null);
  await prisma.$disconnect();
});

test("statement rows reconstruct the opening and closing balances", async () => {
  const response = await getStatement("payer");
  assert.equal(response.status, 200);

  const statement = response.body.data;
  assert.equal(statement.account.walletId, wallets.payer.id);
  assert.equal(statement.account.currency, "ETB");
  assert.equal(statement.account.holder, "payer Statement Test");
  assert.equal(statement.totals.transactions, 2);
  assert.equal(statement.totals.outgoing, "50.00");
  assert.equal(statement.totals.incoming, "20.00");
  assert.equal(statement.closingBalance, "270.00");
  assert.equal(statement.openingBalance, "300.00");

  const rows = statement.transactions;
  assert.deepEqual(
    rows.map((row) => row.direction),
    ["OUTGOING", "INCOMING"]
  );
  assert.equal(parseFloat(rows[0].signedAmount), -50);
  assert.equal(parseFloat(rows[1].signedAmount), 20);
  assert.equal(parseFloat(rows[1].balanceAfter), parseFloat(statement.closingBalance));
});

test("transactions after the window are removed from the closing balance", async () => {
  const later = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  await prisma.transaction.update({
    where: { reference: incomingReference },
    data: { createdAt: later },
  });

  try {
    const statement = (await getStatement("payer")).body.data;
    assert.equal(statement.totals.transactions, 1);
    assert.equal(statement.totals.incoming, "0.00");
    assert.equal(statement.totals.outgoing, "50.00");
    assert.equal(statement.closingBalance, "250.00");
    assert.equal(statement.openingBalance, "300.00");
  } finally {
    await prisma.transaction.update({
      where: { reference: incomingReference },
      data: { createdAt: new Date() },
    });
  }
});

test("an empty period reports the current balance with no rows", async () => {
  const statement = (await getStatement("quiet", `from=${dayOffset(0)}&to=${dayOffset(1)}`)).body
    .data;
  assert.equal(statement.totals.transactions, 0);
  assert.deepEqual(statement.transactions, []);
  assert.equal(statement.openingBalance, "0.00");
  assert.equal(statement.closingBalance, "0.00");

  const future = await getStatement("payer", `from=${dayOffset(3)}&to=${dayOffset(4)}`);
  assert.equal(future.status, 200);
  assert.equal(future.body.data.totals.transactions, 0);
});

test("the requested period is validated", async () => {
  const reversed = await getStatement("payer", `from=${dayOffset(1)}&to=${dayOffset(0)}`);
  assert.equal(reversed.status, 400);
  assert.equal(reversed.body.code, "VALIDATION_ERROR");

  const tooWide = await getStatement("payer", "from=2020-01-01&to=2026-01-01");
  assert.equal(tooWide.status, 400);
  assert.match(tooWide.body.errors.to, /366 days/);

  const malformed = await getStatement("payer", "from=01-01-2026&to=2026-01-02");
  assert.equal(malformed.status, 400);
  assert.ok(malformed.body.errors.from);

  const impossible = await getStatement("payer", "from=2026-02-30&to=2026-03-01");
  assert.equal(impossible.status, 400);

  const defaulted = await request(app)
    .get("/api/v1/statements")
    .set("Authorization", auth("payer"));
  assert.equal(defaulted.status, 200);
  const days =
    (Date.parse(`${defaulted.body.data.period.to}T00:00:00.000Z`) -
      Date.parse(`${defaulted.body.data.period.from}T00:00:00.000Z`)) /
    86400000;
  assert.equal(days, 29);
});

test("statements require authentication and only expose the caller's wallet", async () => {
  const anonymous = await request(app).get("/api/v1/statements");
  assert.equal(anonymous.status, 401);

  const payee = (await getStatement("payee")).body.data;
  const references = payee.transactions.map((row) => row.reference);
  assert.deepEqual(references.sort(), [incomingReference, outgoingReference].sort());
  assert.equal(payee.totals.incoming, "50.00");
  assert.equal(payee.totals.outgoing, "20.00");
});

test("pdf export returns a downloadable statement for the period", async () => {
  const response = await request(app)
    .get(`/api/v1/statements/export.pdf?from=${dayOffset(0)}&to=${dayOffset(1)}`)
    .set("Authorization", auth("payer"))
    .buffer(true)
    .parse((res, cb) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });

  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "application/pdf");
  assert.match(
    response.headers["content-disposition"],
    /^attachment; filename="statement-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.pdf"$/
  );
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(Number(response.headers["content-length"]), response.body.length);
  assert.equal(response.body.subarray(0, 5).toString(), "%PDF-");
  assert.equal(response.body.subarray(-6).toString().trim(), "%%EOF");
});

test("pdf export works for a period without transactions", async () => {
  const response = await request(app)
    .get(`/api/v1/statements/export.pdf?from=${dayOffset(3)}&to=${dayOffset(4)}`)
    .set("Authorization", auth("payer"))
    .buffer(true)
    .parse((res, cb) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.subarray(0, 5).toString(), "%PDF-");
  assert.ok(response.body.length > 500);
});

test("the net effect mirrors the history summary rules", () => {
  const mine = "wallet-1";
  const base = {
    id: "t",
    reference: "r",
    type: "TRANSFER",
    status: "POSTED",
    currency: "ETB",
    sourceWalletId: null,
    destinationWalletId: null,
    amount: decimal("100.00"),
    feeAmount: decimal("2.00"),
    reversedAmount: decimal("0.00"),
    createdAt: new Date(),
  };

  assert.equal(
    statements.netEffect({ ...base, destinationWalletId: mine, type: "DEPOSIT" }, mine).toFixed(2),
    "98.00"
  );
  assert.equal(
    statements.netEffect({ ...base, destinationWalletId: mine }, mine).toFixed(2),
    "100.00"
  );
  assert.equal(statements.netEffect({ ...base, sourceWalletId: mine }, mine).toFixed(2), "-102.00");
  assert.equal(
    statements
      .netEffect(
        { ...base, sourceWalletId: mine, status: "REVERSED", reversedAmount: decimal("100.00") },
        mine
      )
      .toFixed(2),
    "0.00"
  );
  assert.equal(
    statements
      .netEffect({ ...base, sourceWalletId: "other", destinationWalletId: "other" }, mine)
      .toFixed(2),
    "0.00"
  );
});

test("a period ending before the first posting keeps the balance at zero", async () => {
  const early = await getStatement("quiet", "from=2020-01-01&to=2020-12-31");
  assert.equal(early.status, 200);
  assert.equal(early.body.data.totals.transactions, 0);
  assert.equal(early.body.data.closingBalance, "0.00");
});
