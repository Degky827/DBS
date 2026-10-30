const testDatabaseUrl = process.env.WALLET_TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("WALLET_TEST_DATABASE_URL must point to an isolated test database");
}
const testDatabaseName = new URL(testDatabaseUrl).pathname
  .split("/")
  .pop()
  .split("?")[0];
if (!/_test$/i.test(testDatabaseName)) {
  throw new Error("Ledger tests only run against a database whose name ends in _test");
}

process.env.DATABASE_URL = testDatabaseUrl;
process.env.NODE_ENV = "test";
process.env.AUTH_MODE = "dev";
process.env.DEV_API_KEY = "";
process.env.ENABLE_API_DOCS = "true";
process.env.AUTH_RATE_LIMIT_MAX = "1000";
process.env.RATE_LIMIT_MAX = "10000";

const { randomUUID } = require("node:crypto");
const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { Prisma } = require("@prisma/client");
const prisma = require("../src/config/database");
const ledger = require("../src/modules/ledger/ledger.service");
const {
  toMinorUnits,
  fromMinorUnits,
  isValidAmount,
  decimalStringToMinorUnits,
} = require("../src/modules/wallets/money");

const users = {};
const wallets = {};

const createWalletFixture = async (label, balance = "0.00") => {
  const suffix = randomUUID().replace(/-/g, "");
  const user = await prisma.userProfile.create({
    data: {
      firstName: label,
      lastName: "Ledger Test",
      username: `${label}_${suffix.slice(0, 12)}`,
      email: `${label}_${suffix}@ledger.test`,
      phoneNumber: "+15550188",
      dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
      gender: "other",
      passwordHash: "ledger-test-only",
    },
  });
  const wallet = await prisma.wallet.create({ data: { userId: user.id } });
  users[label] = user;
  wallets[label] = wallet;

  if (balance !== "0.00") {
    await prisma.$transaction((tx) =>
      ledger.postEntry({
        tx,
        eventType: "TEST_FUNDING",
        eventRef: `test-funding:${randomUUID()}`,
        currency: "ETB",
        postings: [
          {
            accountCode: ledger.ACCOUNT_CODES.OPENING_BALANCE,
            direction: "DEBIT",
            amount: balance,
          },
          {
            accountCode: `WALLET:${wallet.id}`,
            direction: "CREDIT",
            amount: balance,
          },
        ],
      })
    );
  }
  return wallet;
};

before(async () => {
  await prisma.$connect();
  await createWalletFixture("alpha", "100.00");
  await createWalletFixture("beta", "50.00");
  await createWalletFixture("gamma", "100.00");
  await createWalletFixture("delta", "0.00");
});

after(async () => {
  await prisma.$disconnect();
});

test("money helpers use exact integer minor units", () => {
  assert.equal(toMinorUnits("0.10"), 10n);
  assert.equal(toMinorUnits("0.20"), 20n);
  assert.equal(fromMinorUnits(10n + 20n), "0.30");
  assert.equal(fromMinorUnits(9999999999999999999n), "99999999999999999.99");
  assert.equal(decimalStringToMinorUnits("-1.25"), -125n);
  assert.equal(decimalStringToMinorUnits("0.00"), 0n);

  for (const value of ["0", "-1.00", "1.001", "1e2", "01.00", "", 1, null]) {
    assert.equal(isValidAmount(value), false, `expected ${value} to be invalid`);
  }
  assert.equal(isValidAmount("1.00"), true);
  assert.equal(isValidAmount("99999999999999999.99"), true);
});

const post = (postings, overrides = {}) =>
  prisma.$transaction((tx) =>
    ledger.postEntry({
      tx,
      eventType: "TEST_ENTRY",
      eventRef: `test:${randomUUID()}`,
      currency: "ETB",
      postings,
      ...overrides,
    })
  );

test("balanced postings atomically update ledger accounts and wallet projections", async () => {
  const before = await prisma.wallet.findUnique({ where: { id: wallets.alpha.id } });
  const entry = await post([
    { accountCode: `WALLET:${wallets.alpha.id}`, direction: "DEBIT", amount: "12.34" },
    { accountCode: `WALLET:${wallets.beta.id}`, direction: "CREDIT", amount: "12.34" },
  ]);

  const [alpha, beta, alphaAccount, betaAccount, postings] = await Promise.all([
    prisma.wallet.findUnique({ where: { id: wallets.alpha.id } }),
    prisma.wallet.findUnique({ where: { id: wallets.beta.id } }),
    prisma.ledgerAccount.findUnique({ where: { walletId: wallets.alpha.id } }),
    prisma.ledgerAccount.findUnique({ where: { walletId: wallets.beta.id } }),
    prisma.ledgerPosting.findMany({ where: { journalEntryId: entry.id } }),
  ]);

  assert.equal(alpha.balance.toFixed(2), before.balance.minus("12.34").toFixed(2));
  assert.equal(alphaAccount.balance.toFixed(2), alpha.balance.toFixed(2));
  assert.equal(betaAccount.balance.toFixed(2), beta.balance.toFixed(2));
  assert.equal(postings.length, 2);
  assert.equal(
    postings.reduce((total, posting) => total + Number(posting.amount), 0),
    24.68
  );
});

test("the ledger service rejects invalid, duplicated, and unbalanced postings", async () => {
  const walletPosting = (direction, amount) => ({
    accountCode: `WALLET:${wallets.alpha.id}`,
    direction,
    amount,
  });
  const clearing = (direction, amount) => ({
    accountCode: ledger.ACCOUNT_CODES.PROVIDER_CLEARING,
    direction,
    amount,
  });

  await assert.rejects(
    post([walletPosting("DEBIT", "5.00"), clearing("CREDIT", "4.00")]),
    (error) => error.code === "UNBALANCED_JOURNAL_ENTRY"
  );
  await assert.rejects(
    post([walletPosting("DEBIT", "5.00"), walletPosting("DEBIT", "5.00")]),
    (error) => error.code === "DUPLICATE_LEDGER_POSTING"
  );

  const alphaAccount = await prisma.ledgerAccount.findUnique({
    where: { code: `WALLET:${wallets.alpha.id}` },
  });
  await assert.rejects(
    post([
      { accountId: alphaAccount.id, direction: "CREDIT", amount: "1.00" },
      {
        accountCode: `WALLET:${wallets.alpha.id}`,
        direction: "CREDIT",
        amount: "1.00",
      },
      clearing("DEBIT", "2.00"),
    ]),
    (error) => error.code === "DUPLICATE_LEDGER_POSTING"
  );
  await assert.rejects(
    post([walletPosting("DEBIT", "0"), clearing("CREDIT", "0")]),
    TypeError
  );
  await assert.rejects(
    post([walletPosting("DEBIT", "-1.00"), clearing("CREDIT", "-1.00")]),
    TypeError
  );
  await assert.rejects(
    post([walletPosting("SIDEWAYS", "1.00"), clearing("CREDIT", "1.00")]),
    (error) => error.code === "INVALID_LEDGER_POSTING"
  );
  await assert.rejects(
    post([
      { ...walletPosting("DEBIT", "1.00"), currency: "USD" },
      clearing("CREDIT", "1.00"),
    ]),
    (error) => error.code === "LEDGER_CURRENCY_MISMATCH"
  );
  await assert.rejects(
    post([
      { accountCode: "WALLET:missing", direction: "DEBIT", amount: "1.00" },
      clearing("CREDIT", "1.00"),
    ]),
    (error) => error.code === "LEDGER_ACCOUNT_MISSING"
  );

  const eventRef = `duplicate:${randomUUID()}`;
  const postings = [
    {
      accountCode: ledger.ACCOUNT_CODES.PROVIDER_CLEARING,
      direction: "DEBIT",
      amount: "1.00",
    },
    { accountCode: `WALLET:${wallets.delta.id}`, direction: "CREDIT", amount: "1.00" },
  ];
  await post(postings, { eventRef });
  await assert.rejects(
    post(postings, { eventRef }),
    (error) => error.code === "P2002"
  );
});

test("the database independently rejects unbalanced entries and projection drift", async () => {
  const clearing = await prisma.ledgerAccount.findUnique({
    where: { code: ledger.ACCOUNT_CODES.PROVIDER_CLEARING },
  });
  const walletAccount = await prisma.ledgerAccount.findUnique({
    where: { walletId: wallets.delta.id },
  });

  const unbalancedEntry = prisma.$transaction(async (tx) => {
    const entryId = randomUUID();
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "JournalEntry"
        ("id", "reference", "eventType", "eventRef", "status", "currency")
      VALUES (${entryId}, ${`JRN-RAW-${entryId}`}, 'RAW_TEST',
              ${`raw:${entryId}`}, 'POSTED', 'ETB')
    `);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "LedgerPosting"
        ("id", "journalEntryId", "ledgerAccountId", "direction", "amount", "currency")
      VALUES (${randomUUID()}, ${entryId}, ${clearing.id}, 'DEBIT', 5.00, 'ETB'),
             (${randomUUID()}, ${entryId}, ${walletAccount.id}, 'CREDIT', 4.00, 'ETB')
    `);
  });
  await assert.rejects(unbalancedEntry, /unbalanced/i);

  const projectionDrift = prisma.wallet.update({
    where: { id: wallets.delta.id },
    data: { balance: { increment: "1.00" } },
  });
  await assert.rejects(projectionDrift, /does not match ledger/i);

  const existingEntry = await prisma.journalEntry.findFirst({
    select: { id: true },
  });
  const nonPositive = prisma.$executeRaw(Prisma.sql`
    INSERT INTO "LedgerPosting"
      ("id", "journalEntryId", "ledgerAccountId", "direction", "amount", "currency")
    VALUES (${randomUUID()}, ${existingEntry.id}, ${walletAccount.id},
            'CREDIT', 0.00, 'ETB')
  `);
  await assert.rejects(nonPositive, /amount_positive|positive|check/i);
});

test("concurrent postings cannot overdraw a wallet", async () => {
  const deltaBefore = await prisma.wallet.findUnique({
    where: { id: wallets.delta.id },
  });
  const results = await Promise.allSettled([
    post([
      { accountCode: `WALLET:${wallets.gamma.id}`, direction: "DEBIT", amount: "70.00" },
      { accountCode: `WALLET:${wallets.delta.id}`, direction: "CREDIT", amount: "70.00" },
    ]),
    post([
      { accountCode: `WALLET:${wallets.gamma.id}`, direction: "DEBIT", amount: "70.00" },
      { accountCode: `WALLET:${wallets.delta.id}`, direction: "CREDIT", amount: "70.00" },
    ]),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.equal(rejected.reason.code, "INSUFFICIENT_FUNDS");
  assert.equal(
    (await prisma.wallet.findUnique({ where: { id: wallets.gamma.id } })).balance.toFixed(2),
    "30.00"
  );
  assert.equal(
    (await prisma.wallet.findUnique({ where: { id: wallets.delta.id } })).balance.toFixed(2),
    deltaBefore.balance.plus("70.00").toFixed(2)
  );
});

test("every wallet projection matches its ledger balance and posted entries balance", async () => {
  const mismatches = await prisma.$queryRaw(Prisma.sql`
    SELECT wallet."id"
    FROM "Wallet" wallet
    JOIN "LedgerAccount" account ON account."walletId" = wallet."id"
    WHERE wallet."balance" <> account."balance"
  `);
  assert.deepEqual(mismatches, []);

  const unbalanced = await prisma.$queryRaw(Prisma.sql`
    SELECT entry."id"
    FROM "JournalEntry" entry
    JOIN "LedgerPosting" posting ON posting."journalEntryId" = entry."id"
    GROUP BY entry."id"
    HAVING SUM(CASE WHEN posting."direction" = 'DEBIT' THEN posting."amount" ELSE -posting."amount" END) <> 0
  `);
  assert.deepEqual(unbalanced, []);

  const unjournaledPosted = await prisma.$queryRaw(Prisma.sql`
    SELECT transaction_row."id"
    FROM "Transaction" transaction_row
    LEFT JOIN "JournalEntry" entry ON entry."transactionId" = transaction_row."id"
    WHERE transaction_row."status" <> 'LEGACY' AND entry."id" IS NULL
  `);
  assert.deepEqual(unjournaledPosted, []);

  const journaledLegacy = await prisma.$queryRaw(Prisma.sql`
    SELECT transaction_row."id"
    FROM "Transaction" transaction_row
    JOIN "JournalEntry" entry ON entry."transactionId" = transaction_row."id"
    WHERE transaction_row."status" = 'LEGACY'
  `);
  assert.deepEqual(journaledLegacy, []);
});
