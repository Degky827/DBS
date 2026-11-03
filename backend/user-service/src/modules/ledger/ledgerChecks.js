const { decimalStringToMinorUnits, fromMinorUnits } = require("../wallets/money");

// Ledger integrity checks expressed as SQL aggregates rather than in-process
// scans. Postgres sums DECIMAL(19,2) exactly, so no floating point ever touches
// a comparison, and the work stays bounded on a large ledger.
//
// Each check returns issue descriptors. The same code path serves the CLI
// (prisma/verifyLedger.js), the scheduled job and the admin "run now" action, so
// a failure is reported identically everywhere.

const cents = (value) => decimalStringToMinorUnits(String(value));

// DECIMAL(19,2) is the widest amount a finding can be recorded in, and it is the
// same ceiling the money helpers use. An aggregate over an unusually large or
// polluted book can pass it; such a value is kept in details as text instead of
// failing the insert, because dropping the finding would hide an inconsistency.
const MAX_STORED_CENTS = 9999999999999999999n;

const centsOrNull = (value) => {
  try {
    return cents(value);
  } catch {
    return null;
  }
};

// fromMinorUnits only speaks unsigned amounts; integrity differences can be
// negative, so they are formatted through here.
const formatCents = (value) => {
  if (value < 0n) return `-${fromMinorUnits(-value)}`;
  return fromMinorUnits(value);
};

const toDecimalString = (value) => {
  if (value === null || value === undefined) return null;
  return String(value);
};

const SEVERITY = Object.freeze({
  CRITICAL: "CRITICAL",
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
});

const issue = ({
  classification,
  severity,
  aggregateType,
  aggregateId,
  accountCode = null,
  expected = null,
  actual = null,
  details = null,
}) => {
  const expectedValue = toDecimalString(expected);
  const actualValue = toDecimalString(actual);
  const expectedCents = expectedValue === null ? null : centsOrNull(expectedValue);
  const actualCents = actualValue === null ? null : centsOrNull(actualValue);
  let difference = null;
  if (expectedCents !== null && actualCents !== null) {
    const delta = actualCents - expectedCents;
    if (delta <= MAX_STORED_CENTS && delta >= -MAX_STORED_CENTS) difference = formatCents(delta);
  }
  const outOfRange =
    (expectedValue !== null && expectedCents === null) ||
    (actualValue !== null && actualCents === null) ||
    (expectedCents !== null && actualCents !== null && difference === null);
  return {
    classification,
    severity,
    aggregateType,
    aggregateId: String(aggregateId),
    accountCode,
    expected: expectedCents === null ? null : expectedValue,
    actual: actualCents === null ? null : actualValue,
    difference,
    details: outOfRange
      ? {
          ...(details || {}),
          amountOutOfRange: { expected: expectedValue, actual: actualValue },
        }
      : details,
  };
};

const ENTRY_CHECKS = [
  {
    classification: "ENTRY_WITHOUT_POSTINGS",
    severity: SEVERITY.CRITICAL,
    aggregateType: "JOURNAL_ENTRY",
    sql: `SELECT entry."id", entry."reference", COUNT(posting."id")::int AS postings
      FROM "JournalEntry" entry
      LEFT JOIN "LedgerPosting" posting ON posting."journalEntryId" = entry."id"
      GROUP BY entry."id", entry."reference"
      HAVING COUNT(posting."id") < 2`,
    map: (row) => ({
      aggregateId: row.id,
      details: { reference: row.reference, postings: row.postings },
    }),
  },
  {
    classification: "ENTRY_UNBALANCED",
    severity: SEVERITY.CRITICAL,
    aggregateType: "JOURNAL_ENTRY",
    // Debits and credits are compared in cents by Postgres; both sides are
    // exact DECIMAL sums, never a float.
    sql: `SELECT entry."id", entry."reference",
        COALESCE(SUM(CASE WHEN posting."direction" = 'DEBIT' THEN posting."amount" END), 0)::text AS debit,
        COALESCE(SUM(CASE WHEN posting."direction" = 'CREDIT' THEN posting."amount" END), 0)::text AS credit
      FROM "JournalEntry" entry
      JOIN "LedgerPosting" posting ON posting."journalEntryId" = entry."id"
      GROUP BY entry."id", entry."reference"
      HAVING COALESCE(SUM(CASE WHEN posting."direction" = 'DEBIT' THEN posting."amount" END), 0)
          <> COALESCE(SUM(CASE WHEN posting."direction" = 'CREDIT' THEN posting."amount" END), 0)`,
    map: (row) => ({
      aggregateId: row.id,
      expected: row.debit,
      actual: row.credit,
      details: { reference: row.reference, debit: row.debit, credit: row.credit },
    }),
  },
  {
    classification: "ENTRY_POSTING_CURRENCY",
    severity: SEVERITY.HIGH,
    aggregateType: "JOURNAL_ENTRY",
    sql: `SELECT entry."id", entry."reference", entry."currency", posting."currency" AS posting_currency,
        COUNT(*)::int AS mismatched
      FROM "JournalEntry" entry
      JOIN "LedgerPosting" posting ON posting."journalEntryId" = entry."id"
      WHERE posting."currency" <> entry."currency"
      GROUP BY entry."id", entry."reference", entry."currency", posting."currency"`,
    map: (row) => ({
      aggregateId: row.id,
      details: {
        reference: row.reference,
        entryCurrency: row.currency,
        postingCurrency: row.posting_currency,
        postings: row.mismatched,
      },
    }),
  },
  {
    classification: "ENTRY_NOT_POSTED",
    severity: SEVERITY.HIGH,
    aggregateType: "JOURNAL_ENTRY",
    sql: `SELECT entry."id", entry."reference", entry."status"
      FROM "JournalEntry" entry
      WHERE entry."status" <> 'POSTED'`,
    map: (row) => ({
      aggregateId: row.id,
      actual: null,
      details: { reference: row.reference, status: row.status },
    }),
  },
  {
    classification: "ENTRY_UNATTRIBUTED",
    severity: SEVERITY.LOW,
    aggregateType: "JOURNAL_ENTRY",
    // Every posted entry must belong to something: a transaction, a withdrawal
    // reservation, a reversal, an opening balance or a payout settlement.
    sql: `SELECT entry."id", entry."reference", entry."eventType", entry."eventRef"
      FROM "JournalEntry" entry
      WHERE entry."transactionId" IS NULL
        AND entry."withdrawalId" IS NULL
        AND entry."reversalOfId" IS NULL
        AND entry."eventType" NOT IN ('OPENING_BALANCE', 'PAYOUT_SETTLEMENT', 'PAYOUT_REVERSAL')`,
    map: (row) => ({
      aggregateId: row.id,
      details: { reference: row.reference, eventType: row.eventType, eventRef: row.eventRef },
    }),
  },
  {
    classification: "REVERSAL_TARGET_MISMATCH",
    severity: SEVERITY.CRITICAL,
    aggregateType: "JOURNAL_ENTRY",
    sql: `SELECT reversal."id", reversal."reference", reversal."transactionId",
        original."id" AS original_entry, reversed."reversalOfId" AS reversal_of
      FROM "TransactionReversal" reversal
      JOIN "JournalEntry" reversed ON reversed."id" = reversal."journalEntryId"
      JOIN "Transaction" transaction ON transaction."id" = reversal."transactionId"
      LEFT JOIN "JournalEntry" original ON original."transactionId" = transaction."id"
      WHERE reversed."reversalOfId" IS NULL
         OR (original."id" IS NOT NULL AND reversed."reversalOfId" <> original."id")`,
    map: (row) => ({
      aggregateType: "TRANSACTION_REVERSAL",
      aggregateId: row.id,
      details: {
        reference: row.reference,
        transactionId: row.transactionId,
        originalEntry: row.original_entry,
        reversalOf: row.reversal_of,
      },
    }),
  },
  {
    classification: "REVERSAL_AMOUNT_INVALID",
    severity: SEVERITY.CRITICAL,
    aggregateType: "TRANSACTION_REVERSAL",
    sql: `SELECT reversal."id", reversal."reference", reversal."amount"::text AS amount
      FROM "TransactionReversal" reversal
      WHERE reversal."amount" <= 0`,
    map: (row) => ({
      aggregateId: row.id,
      actual: row.amount,
      details: { reference: row.reference },
    }),
  },
  {
    classification: "REVERSAL_CURRENCY_MISMATCH",
    severity: SEVERITY.HIGH,
    aggregateType: "TRANSACTION_REVERSAL",
    sql: `SELECT reversal."id", reversal."reference", reversal."currency",
        transaction."currency" AS transaction_currency
      FROM "TransactionReversal" reversal
      JOIN "Transaction" transaction ON transaction."id" = reversal."transactionId"
      WHERE reversal."currency" <> transaction."currency"`,
    map: (row) => ({
      aggregateId: row.id,
      details: {
        reference: row.reference,
        reversalCurrency: row.currency,
        transactionCurrency: row.transaction_currency,
      },
    }),
  },
  {
    classification: "REVERSAL_ON_LEGACY_TRANSACTION",
    severity: SEVERITY.HIGH,
    aggregateType: "TRANSACTION_REVERSAL",
    // Pre-ledger rows are frozen history; they must never gain reversals.
    sql: `SELECT reversal."id", reversal."reference", transaction."reference" AS transaction_reference
      FROM "TransactionReversal" reversal
      JOIN "Transaction" transaction ON transaction."id" = reversal."transactionId"
      WHERE transaction."status" = 'LEGACY'`,
    map: (row) => ({
      aggregateId: row.id,
      details: { reference: row.reference, transactionReference: row.transaction_reference },
    }),
  },
];

const ACCOUNT_CHECKS = [
  {
    classification: "ACCOUNT_PROJECTION_MISMATCH",
    severity: SEVERITY.CRITICAL,
    aggregateType: "LEDGER_ACCOUNT",
    sql: `SELECT account."id", account."code", account."normalBalance", account."balance"::text AS stored,
        CASE WHEN account."normalBalance" = 'DEBIT'
          THEN COALESCE(SUM(CASE WHEN posting."direction" = 'DEBIT' THEN posting."amount" ELSE -posting."amount" END), 0)
          ELSE COALESCE(SUM(CASE WHEN posting."direction" = 'CREDIT' THEN posting."amount" ELSE -posting."amount" END), 0)
        END::text AS projected
      FROM "LedgerAccount" account
      LEFT JOIN "LedgerPosting" posting ON posting."ledgerAccountId" = account."id"
      GROUP BY account."id", account."code", account."normalBalance", account."balance"
      HAVING account."balance" <> CASE WHEN account."normalBalance" = 'DEBIT'
          THEN COALESCE(SUM(CASE WHEN posting."direction" = 'DEBIT' THEN posting."amount" ELSE -posting."amount" END), 0)
          ELSE COALESCE(SUM(CASE WHEN posting."direction" = 'CREDIT' THEN posting."amount" ELSE -posting."amount" END), 0)
        END`,
    map: (row) => ({
      aggregateId: row.id,
      accountCode: row.code,
      expected: row.projected,
      actual: row.stored,
      details: { normalBalance: row.normalBalance },
    }),
  },
  {
    classification: "ACCOUNT_NEGATIVE_PROJECTION",
    severity: SEVERITY.HIGH,
    aggregateType: "LEDGER_ACCOUNT",
    // Customer wallet liabilities and reserved balances may never be negative;
    // the platform's own accounts are allowed to move in either direction.
    sql: `SELECT account."id", account."code", account."balance"::text AS stored
      FROM "LedgerAccount" account
      WHERE account."walletId" IS NOT NULL AND account."balance" < 0`,
    map: (row) => ({
      aggregateId: row.id,
      accountCode: row.code,
      actual: row.stored,
    }),
  },
  {
    classification: "WALLET_BALANCE_MISMATCH",
    severity: SEVERITY.CRITICAL,
    aggregateType: "WALLET",
    sql: `SELECT wallet."id", wallet."balance"::text AS wallet_balance, account."balance"::text AS ledger_balance,
        account."code" AS account_code
      FROM "Wallet" wallet
      JOIN "LedgerAccount" account ON account."walletId" = wallet."id"
      WHERE wallet."balance" <> account."balance"`,
    map: (row) => ({
      aggregateId: row.id,
      accountCode: row.account_code,
      expected: row.ledger_balance,
      actual: row.wallet_balance,
    }),
  },
  {
    classification: "WALLET_WITHOUT_LEDGER_ACCOUNT",
    severity: SEVERITY.CRITICAL,
    aggregateType: "WALLET",
    sql: `SELECT wallet."id", wallet."userId"
      FROM "Wallet" wallet
      LEFT JOIN "LedgerAccount" account ON account."walletId" = wallet."id"
      WHERE account."id" IS NULL`,
    map: (row) => ({ aggregateId: row.id, details: { userId: row.userId } }),
  },
  {
    classification: "WALLET_ACCOUNT_CURRENCY_MISMATCH",
    severity: SEVERITY.HIGH,
    aggregateType: "WALLET",
    sql: `SELECT wallet."id", wallet."currency", account."currency" AS account_currency, account."code" AS account_code
      FROM "Wallet" wallet
      JOIN "LedgerAccount" account ON account."walletId" = wallet."id"
      WHERE wallet."currency" <> account."currency"`,
    map: (row) => ({
      aggregateId: row.id,
      accountCode: row.account_code,
      details: { walletCurrency: row.currency, accountCurrency: row.account_currency },
    }),
  },
  {
    classification: "TRIAL_BALANCE_UNBALANCED",
    severity: SEVERITY.CRITICAL,
    aggregateType: "LEDGER",
    // Whole-books check: every debit-normal projection must be matched by the
    // credit-normal projections.
    sql: `SELECT
        SUM(CASE WHEN account."normalBalance" = 'DEBIT' THEN account."balance" ELSE 0 END)::text AS debit_normal,
        SUM(CASE WHEN account."normalBalance" = 'CREDIT' THEN account."balance" ELSE 0 END)::text AS credit_normal
      FROM "LedgerAccount" account
      HAVING SUM(CASE WHEN account."normalBalance" = 'DEBIT' THEN account."balance" ELSE 0 END)
          <> SUM(CASE WHEN account."normalBalance" = 'CREDIT' THEN account."balance" ELSE 0 END)`,
    map: (row) => ({
      aggregateId: "trial-balance",
      expected: row.credit_normal,
      actual: row.debit_normal,
    }),
  },
];

const TRANSACTION_CHECKS = [
  {
    classification: "TRANSACTION_WITHOUT_JOURNAL_ENTRY",
    severity: SEVERITY.CRITICAL,
    aggregateType: "TRANSACTION",
    sql: `SELECT transaction."id", transaction."reference", transaction."type", transaction."status"
      FROM "Transaction" transaction
      LEFT JOIN "JournalEntry" entry ON entry."transactionId" = transaction."id"
      WHERE transaction."status" <> 'LEGACY' AND entry."id" IS NULL`,
    map: (row) => ({
      aggregateId: row.id,
      details: { reference: row.reference, type: row.type, status: row.status },
    }),
  },
  {
    classification: "LEGACY_TRANSACTION_WITH_ENTRY",
    severity: SEVERITY.HIGH,
    aggregateType: "TRANSACTION",
    sql: `SELECT transaction."id", transaction."reference"
      FROM "Transaction" transaction
      LEFT JOIN "JournalEntry" entry ON entry."transactionId" = transaction."id"
      LEFT JOIN "TransactionReversal" reversal ON reversal."transactionId" = transaction."id"
      WHERE transaction."status" = 'LEGACY' AND (entry."id" IS NOT NULL OR reversal."id" IS NOT NULL)`,
    map: (row) => ({
      aggregateId: row.id,
      details: { reference: row.reference },
    }),
  },
  {
    classification: "TRANSACTION_REVERSED_AMOUNT_MISMATCH",
    severity: SEVERITY.CRITICAL,
    aggregateType: "TRANSACTION",
    sql: `SELECT transaction."id", transaction."reference", transaction."amount"::text AS amount,
        transaction."reversedAmount"::text AS reversed_amount, transaction."status",
        COALESCE(SUM(reversal."amount"), 0)::text AS reversal_total
      FROM "Transaction" transaction
      LEFT JOIN "TransactionReversal" reversal ON reversal."transactionId" = transaction."id"
      WHERE transaction."status" <> 'LEGACY'
      GROUP BY transaction."id", transaction."reference", transaction."amount",
        transaction."reversedAmount", transaction."status"
      HAVING transaction."reversedAmount" <> COALESCE(SUM(reversal."amount"), 0)`,
    map: (row) => ({
      aggregateId: row.id,
      expected: row.reversal_total,
      actual: row.reversed_amount,
      details: { reference: row.reference, amount: row.amount, status: row.status },
    }),
  },
  {
    classification: "TRANSACTION_OVER_REVERSED",
    severity: SEVERITY.CRITICAL,
    aggregateType: "TRANSACTION",
    sql: `SELECT transaction."id", transaction."reference", transaction."amount"::text AS amount,
        transaction."reversedAmount"::text AS reversed_amount
      FROM "Transaction" transaction
      WHERE transaction."reversedAmount" > transaction."amount"`,
    map: (row) => ({
      aggregateId: row.id,
      expected: row.amount,
      actual: row.reversed_amount,
      details: { reference: row.reference },
    }),
  },
  {
    classification: "TRANSACTION_STATUS_MISMATCH",
    severity: SEVERITY.HIGH,
    aggregateType: "TRANSACTION",
    sql: `SELECT transaction."id", transaction."reference", transaction."status",
        transaction."amount"::text AS amount, transaction."reversedAmount"::text AS reversed_amount
      FROM "Transaction" transaction
      WHERE transaction."status" <> 'LEGACY'
        AND transaction."status" <> CASE
          WHEN transaction."reversedAmount" = 0 THEN 'POSTED'
          WHEN transaction."reversedAmount" = transaction."amount" THEN 'REVERSED'
          ELSE 'PARTIALLY_REVERSED'
        END`,
    map: (row) => ({
      aggregateId: row.id,
      details: {
        reference: row.reference,
        status: row.status,
        amount: row.amount,
        reversedAmount: row.reversed_amount,
      },
    }),
  },
  {
    classification: "DEPOSIT_PAYMENT_LINK_MISSING",
    severity: SEVERITY.HIGH,
    aggregateType: "TRANSACTION",
    sql: `SELECT transaction."id", transaction."reference", payment."status" AS payment_status,
        payment."amount"::text AS payment_amount, payment."currency" AS payment_currency
      FROM "Transaction" transaction
      LEFT JOIN "Payment" payment ON payment."id" = transaction."paymentId"
      WHERE transaction."type" = 'DEPOSIT' AND payment."id" IS NULL`,
    map: (row) => ({
      aggregateId: row.id,
      details: { reference: row.reference },
    }),
  },
  {
    classification: "DEPOSIT_PAYMENT_INCONSISTENT",
    severity: SEVERITY.CRITICAL,
    aggregateType: "TRANSACTION",
    sql: `SELECT transaction."id", transaction."reference", payment."status" AS payment_status,
        payment."amount"::text AS payment_amount, transaction."amount"::text AS amount,
        payment."currency" AS payment_currency, transaction."currency" AS currency
      FROM "Transaction" transaction
      JOIN "Payment" payment ON payment."id" = transaction."paymentId"
      WHERE transaction."type" = 'DEPOSIT'
        AND (payment."status" <> 'COMPLETED'
          OR payment."amount" <> transaction."amount"
          OR payment."currency" <> transaction."currency")`,
    map: (row) => ({
      aggregateId: row.id,
      expected: row.payment_amount,
      actual: row.amount,
      details: {
        reference: row.reference,
        paymentStatus: row.payment_status,
        paymentCurrency: row.payment_currency,
        currency: row.currency,
      },
    }),
  },
  {
    classification: "PAYMENT_COMPLETED_WITHOUT_TRANSACTION",
    severity: SEVERITY.CRITICAL,
    aggregateType: "PAYMENT",
    sql: `SELECT payment."id", payment."reference", payment."status"
      FROM "Payment" payment
      LEFT JOIN "Transaction" transaction ON transaction."paymentId" = payment."id"
      WHERE payment."status" = 'COMPLETED' AND transaction."id" IS NULL`,
    map: (row) => ({ aggregateId: row.id, details: { reference: row.reference } }),
  },
  {
    classification: "PAYMENT_UNCOMPLETED_WITH_TRANSACTION",
    severity: SEVERITY.CRITICAL,
    aggregateType: "PAYMENT",
    sql: `SELECT payment."id", payment."reference", payment."status"
      FROM "Payment" payment
      JOIN "Transaction" transaction ON transaction."paymentId" = payment."id"
      WHERE payment."status" <> 'COMPLETED'`,
    map: (row) => ({
      aggregateId: row.id,
      details: { reference: row.reference, status: row.status },
    }),
  },
];

const WITHDRAWAL_CHECKS = [
  {
    classification: "WITHDRAWAL_RESERVATION_MISSING",
    severity: SEVERITY.CRITICAL,
    aggregateType: "WITHDRAWAL",
    sql: `SELECT withdrawal."id", withdrawal."reference", withdrawal."status"
      FROM "Withdrawal" withdrawal
      LEFT JOIN "JournalEntry" entry ON entry."withdrawalId" = withdrawal."id"
      WHERE entry."id" IS NULL`,
    map: (row) => ({
      aggregateId: row.id,
      details: { reference: row.reference, status: row.status },
    }),
  },
  {
    classification: "WITHDRAWAL_RESERVED_ACCOUNT_MISMATCH",
    severity: SEVERITY.CRITICAL,
    aggregateType: "LEDGER_ACCOUNT",
    // Funds are held on the reserved account while a withdrawal is PENDING or
    // PROCESSING. SETTLED leaves through the payout account and CANCELLED or
    // FAILED returns to the wallet, so neither keeps a reservation.
    sql: `SELECT account."id", account."code", account."balance"::text AS stored,
        COALESCE(held."total", 0)::text AS held
      FROM "LedgerAccount" account
      LEFT JOIN (
        SELECT SUM("amount") AS total FROM "Withdrawal" WHERE "status" IN ('PENDING', 'PROCESSING')
      ) held ON TRUE
      WHERE account."code" = 'PLATFORM:WITHDRAWAL_RESERVED'
        AND account."balance" <> COALESCE(held."total", 0)`,
    map: (row) => ({
      aggregateId: row.id,
      accountCode: row.code,
      expected: row.held,
      actual: row.stored,
    }),
  },
];

const PAYOUT_CHECKS = [
  {
    classification: "PAYOUT_SUCCESS_WITHOUT_RESERVATION",
    severity: SEVERITY.CRITICAL,
    aggregateType: "PAYOUT",
    sql: `SELECT payout."id", payout."reference", withdrawal."status" AS withdrawal_status
      FROM "Payout" payout
      JOIN "Withdrawal" withdrawal ON withdrawal."id" = payout."withdrawalId"
      WHERE payout."status" IN ('PROCESSING', 'SUCCESS')
        AND withdrawal."status" NOT IN ('PROCESSING', 'SETTLED')`,
    map: (row) => ({
      aggregateId: row.id,
      details: { reference: row.reference, withdrawalStatus: row.withdrawal_status },
    }),
  },
  {
    classification: "PAYOUT_SETTLEMENT_MISMATCH",
    severity: SEVERITY.CRITICAL,
    aggregateType: "PAYOUT",
    // A settled payout must point at a real settlement entry whose postings
    // actually reach the payout settlement account.
    sql: `SELECT payout."id", payout."reference", payout."amount"::text AS amount,
        entry."id" AS entry_id, entry."currency" AS entry_currency, payout."currency" AS currency
      FROM "Payout" payout
      LEFT JOIN "JournalEntry" entry ON entry."id" = payout."settlementEntryId"
      WHERE payout."status" = 'SUCCESS'
        AND (entry."id" IS NULL
          OR entry."eventType" <> 'PAYOUT_SETTLEMENT'
          OR entry."currency" <> payout."currency")`,
    map: (row) => ({
      aggregateId: row.id,
      details: {
        reference: row.reference,
        amount: row.amount,
        settlementEntry: row.entry_id,
        entryCurrency: row.entry_currency,
        currency: row.currency,
      },
    }),
  },
  {
    classification: "PAYOUT_SETTLEMENT_DEBIT_MISMATCH",
    severity: SEVERITY.CRITICAL,
    aggregateType: "PAYOUT",
    // The settlement entry must move exactly the payout amount onto the payout
    // account; fees belong to the fee account, not here.
    sql: `SELECT payout."id", payout."reference", payout."amount"::text AS amount,
        COALESCE(SUM(CASE WHEN posting."direction" = 'DEBIT' THEN posting."amount" END), 0)::text AS settled_debit,
        COUNT(posting."id")::int AS postings
      FROM "Payout" payout
      JOIN "JournalEntry" entry ON entry."id" = payout."settlementEntryId"
      JOIN "LedgerAccount" account ON account."code" = 'PLATFORM:PAYOUT_SETTLEMENT'
      LEFT JOIN "LedgerPosting" posting
        ON posting."journalEntryId" = entry."id" AND posting."ledgerAccountId" = account."id"
      WHERE payout."status" = 'SUCCESS'
      GROUP BY payout."id", payout."reference", payout."amount"
      HAVING COALESCE(SUM(CASE WHEN posting."direction" = 'DEBIT' THEN posting."amount" END), 0)
          <> payout."amount"`,
    map: (row) => ({
      aggregateId: row.id,
      accountCode: "PLATFORM:PAYOUT_SETTLEMENT",
      expected: row.amount,
      actual: row.settled_debit,
      details: { reference: row.reference, postings: row.postings },
    }),
  },
  {
    classification: "PAYOUT_SETTLED_ACCOUNT_MISMATCH",
    severity: SEVERITY.CRITICAL,
    aggregateType: "LEDGER_ACCOUNT",
    // Money disbursed equals successful payouts minus the ones the provider
    // later reversed back.
    sql: `SELECT account."id", account."code", account."balance"::text AS stored,
        COALESCE(SUM(movement."signed"), 0)::text AS settled_total
      FROM "LedgerAccount" account
      LEFT JOIN (
        SELECT "amount" AS signed FROM "Payout" WHERE "status" = 'SUCCESS'
        UNION ALL
        SELECT -"amount" FROM "Payout" WHERE "status" = 'REVERSED'
      ) movement ON TRUE
      WHERE account."code" = 'PLATFORM:PAYOUT_SETTLEMENT'
      GROUP BY account."id", account."code", account."balance"
      HAVING account."balance" <> COALESCE(SUM(movement."signed"), 0)`,
    map: (row) => ({
      aggregateId: row.id,
      accountCode: row.code,
      expected: row.settled_total,
      actual: row.stored,
    }),
  },
  {
    classification: "PAYOUT_WITHDRAWAL_STATE_MISMATCH",
    severity: SEVERITY.HIGH,
    aggregateType: "PAYOUT",
    // A settled withdrawal is exactly a successful payout, and a cancelled or
    // failed one can never have money on its way out.
    sql: `SELECT payout."id", payout."reference", payout."status" AS payout_status,
        withdrawal."reference" AS withdrawal_reference, withdrawal."status" AS withdrawal_status
      FROM "Payout" payout
      JOIN "Withdrawal" withdrawal ON withdrawal."id" = payout."withdrawalId"
      WHERE (payout."status" = 'SUCCESS' AND withdrawal."status" <> 'SETTLED')
         OR (withdrawal."status" = 'SETTLED' AND payout."status" NOT IN ('SUCCESS', 'REVERSED'))
         OR (withdrawal."status" IN ('CANCELLED', 'FAILED')
             AND payout."status" IN ('PENDING', 'PROCESSING', 'SUCCESS'))`,
    map: (row) => ({
      aggregateId: row.id,
      details: {
        reference: row.reference,
        payoutStatus: row.payout_status,
        withdrawalReference: row.withdrawal_reference,
        withdrawalStatus: row.withdrawal_status,
      },
    }),
  },
  {
    classification: "PAYOUT_SETTLEMENT_ORPHAN",
    severity: SEVERITY.HIGH,
    aggregateType: "JOURNAL_ENTRY",
    // Settlement entries exist because a payout asked for them. An orphan means
    // money left the reserve without a payout record to explain it.
    sql: `SELECT entry."id", entry."reference", entry."eventType", entry."eventRef"
      FROM "JournalEntry" entry
      WHERE entry."eventType" IN ('PAYOUT_SETTLEMENT', 'PAYOUT_REVERSAL')
        AND NOT EXISTS (
          SELECT 1 FROM "Payout" payout WHERE payout."settlementEntryId" = entry."id"
        )`,
    map: (row) => ({
      aggregateId: row.id,
      accountCode: "PLATFORM:PAYOUT_SETTLEMENT",
      details: { reference: row.reference, eventType: row.eventType, eventRef: row.eventRef },
    }),
  },
  {
    classification: "PAYOUT_IN_FLIGHT_TOO_LONG",
    severity: SEVERITY.MEDIUM,
    aggregateType: "PAYOUT",
    // An unresolved provider call is an ambiguity, not a failure: it needs the
    // reconciliation loop, and an operator needs to see it.
    sql: `SELECT payout."id", payout."reference", payout."status", payout."sentAt",
        EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - payout."sentAt"))::int AS age_seconds
      FROM "Payout" payout
      WHERE payout."status" = 'PROCESSING'
        AND payout."sentAt" < CURRENT_TIMESTAMP - INTERVAL '30 minutes'`,
    map: (row) => ({
      aggregateId: row.id,
      details: {
        reference: row.reference,
        status: row.status,
        sentAt: row.sentAt ? new Date(row.sentAt).toISOString() : null,
        ageSeconds: row.age_seconds,
      },
    }),
  },
];

const CHECK_GROUPS = Object.freeze({
  entries: ENTRY_CHECKS,
  accounts: ACCOUNT_CHECKS,
  transactions: TRANSACTION_CHECKS,
  withdrawals: WITHDRAWAL_CHECKS,
  payouts: PAYOUT_CHECKS,
});

const allChecks = () => Object.values(CHECK_GROUPS).flat();

const runCheck = async (prisma, check) => {
  const rows = await prisma.$queryRawUnsafe(check.sql);
  return rows.map((row) =>
    issue({
      classification: check.classification,
      severity: check.severity,
      aggregateType: check.aggregateType,
      ...check.map(row),
    })
  );
};

const runChecks = async (prisma, { groups = Object.keys(CHECK_GROUPS) } = {}) => {
  const detected = [];
  const errors = [];
  let checksRun = 0;
  for (const group of groups) {
    const checks = CHECK_GROUPS[group] || [];
    for (const check of checks) {
      checksRun += 1;
      try {
        detected.push(...(await runCheck(prisma, check)));
      } catch (error) {
        errors.push({
          classification: check.classification,
          error: String(error.message || error),
        });
      }
    }
  }
  return { issues: detected, checkErrors: errors, checksRun };
};

// Headline numbers for the dashboard: totals by direction, wallet liability and
// the reserved/payout positions, all computed as exact DECIMAL sums in the
// database.
const ledgerTotals = async (prisma) => {
  const [postings, accounts, wallets] = await Promise.all([
    // The difference is subtracted in SQL: a whole-book total is not bound by the
    // per-amount ceiling the application money helpers enforce, and Postgres
    // subtracts DECIMAL exactly.
    prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM(CASE WHEN "direction" = 'DEBIT' THEN "amount" END), 0)::text AS debits,
              COALESCE(SUM(CASE WHEN "direction" = 'CREDIT' THEN "amount" END), 0)::text AS credits,
              (COALESCE(SUM(CASE WHEN "direction" = 'CREDIT' THEN "amount" END), 0) -
               COALESCE(SUM(CASE WHEN "direction" = 'DEBIT' THEN "amount" END), 0))::text AS difference
       FROM "LedgerPosting"`
    ),
    prisma.$queryRawUnsafe(
      `SELECT "code", "balance"::text AS balance FROM "LedgerAccount" WHERE "walletId" IS NULL ORDER BY "code"`
    ),
    prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM("balance"), 0)::text AS total, COUNT(*)::int AS wallets,
              COUNT(*) FILTER (WHERE NOT "isActive")::int AS inactiveWallets
       FROM "Wallet"`
    ),
  ]);

  const postingTotals = postings[0] || { debits: "0.00", credits: "0.00", difference: "0.00" };
  const walletTotals = wallets[0] || { total: "0.00", wallets: 0, inactiveWallets: 0 };
  return {
    debits: postingTotals.debits,
    credits: postingTotals.credits,
    difference: postingTotals.difference,
    walletLiability: walletTotals.total,
    wallets: walletTotals.wallets,
    inactiveWallets: walletTotals.inactiveWallets,
    platformAccounts: accounts.map((account) => ({
      code: account.code,
      balance: account.balance,
    })),
  };
};

module.exports = {
  SEVERITY,
  CHECK_GROUPS,
  allChecks,
  runChecks,
  ledgerTotals,
};
