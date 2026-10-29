const crypto = require("crypto");
const { Prisma } = require("@prisma/client");

const ApiError = require("../../utils/ApiError");
const {
  toMinorUnits,
  fromMinorUnits,
  decimalStringToMinorUnits,
} = require("../wallets/money");

const ACCOUNT_CODES = Object.freeze({
  PROVIDER_CLEARING: "PLATFORM:PROVIDER_CLEARING",
  FEE_REVENUE: "PLATFORM:FEE_REVENUE",
  OPENING_BALANCE: "PLATFORM:OPENING_BALANCE",
  WITHDRAWAL_RESERVED: "PLATFORM:WITHDRAWAL_RESERVED",
});

const DIRECTIONS = Object.freeze(["DEBIT", "CREDIT"]);
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

const newReference = (prefix) =>
  `${prefix}-${crypto.randomUUID().replace(/-/g, "")}`;

const assertTransaction = (tx) => {
  if (!tx || typeof tx.journalEntry?.create !== "function") {
    throw new TypeError("Ledger operations require a Prisma transaction client");
  }
};

const normalizePostings = (postings, currency) => {
  if (!Array.isArray(postings) || postings.length < 2) {
    throw ApiError.badRequest(
      "A journal entry requires at least two postings",
      "LEDGER_ENTRY_INCOMPLETE"
    );
  }

  let debitCents = 0n;
  let creditCents = 0n;
  const seen = new Set();

  const normalized = postings.map((posting) => {
    if (!posting || !DIRECTIONS.includes(posting.direction)) {
      throw ApiError.badRequest(
        "Every posting must have a valid direction",
        "INVALID_LEDGER_POSTING"
      );
    }
    if (!posting.accountId && !posting.accountCode) {
      throw ApiError.badRequest(
        "Every posting must identify a ledger account",
        "INVALID_LEDGER_POSTING"
      );
    }
    if (posting.currency && posting.currency !== currency) {
      throw ApiError.badRequest(
        "Posting currency must match the journal entry currency",
        "LEDGER_CURRENCY_MISMATCH"
      );
    }

    const cents = toMinorUnits(posting.amount);
    const key = `${posting.accountId || posting.accountCode}:${posting.direction}`;
    if (seen.has(key)) {
      throw ApiError.badRequest(
        "A journal entry cannot repeat the same account and direction",
        "DUPLICATE_LEDGER_POSTING"
      );
    }
    seen.add(key);

    if (posting.direction === "DEBIT") debitCents += cents;
    else creditCents += cents;

    return {
      accountId: posting.accountId || null,
      accountCode: posting.accountCode || null,
      direction: posting.direction,
      cents,
      amount: fromMinorUnits(cents),
      currency,
    };
  });

  if (debitCents !== creditCents) {
    throw ApiError.badRequest(
      "Journal entry debits and credits must be equal",
      "UNBALANCED_JOURNAL_ENTRY"
    );
  }

  return { postings: normalized, debitCents, creditCents };
};

const resolveAccounts = async (tx, postings, currency) => {
  const ids = postings.filter((posting) => posting.accountId).map((posting) => posting.accountId);
  const codes = postings
    .filter((posting) => posting.accountCode)
    .map((posting) => posting.accountCode);

  const conditions = [];
  if (ids.length) conditions.push({ id: { in: [...new Set(ids)] } });
  if (codes.length) conditions.push({ code: { in: [...new Set(codes)] } });

  const accounts = await tx.ledgerAccount.findMany({
    where: { OR: conditions },
  });
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const byCode = new Map(accounts.map((account) => [account.code, account]));
  const seen = new Set();

  return postings.map((posting) => {
    const account = posting.accountId
      ? byId.get(posting.accountId)
      : byCode.get(posting.accountCode);
    if (!account) {
      throw ApiError.conflict(
        "A required ledger account does not exist",
        "LEDGER_ACCOUNT_MISSING"
      );
    }
    if (!account.isActive) {
      throw ApiError.conflict(
        "A required ledger account is inactive",
        "LEDGER_ACCOUNT_INACTIVE"
      );
    }
    if (account.currency !== currency) {
      throw ApiError.conflict(
        "Ledger account currency does not match the entry",
        "LEDGER_CURRENCY_MISMATCH"
      );
    }

    // The pre-resolution check only compares the identifiers supplied by the
    // caller, so referencing one account by id and again by code would slip
    // through. Re-check against the resolved account identity.
    const key = `${account.id}:${posting.direction}`;
    if (seen.has(key)) {
      throw ApiError.badRequest(
        "A journal entry cannot repeat the same account and direction",
        "DUPLICATE_LEDGER_POSTING"
      );
    }
    seen.add(key);

    return { ...posting, account };
  });
};

const lockAccounts = async (tx, postings) => {
  const accountIds = [...new Set(postings.map((posting) => posting.account.id))].sort();
  const locked = await tx.$queryRaw(Prisma.sql`
    SELECT "id", "balance", "normalBalance", "type", "currency", "isActive", "walletId"
    FROM "LedgerAccount"
    WHERE "id" IN (${Prisma.join(accountIds)})
    ORDER BY "id"
    FOR UPDATE
  `);

  const byId = new Map(locked.map((account) => [account.id, account]));
  return postings.map((posting) => {
    const account = byId.get(posting.account.id);
    if (!account) {
      throw ApiError.conflict(
        "A required ledger account does not exist",
        "LEDGER_ACCOUNT_MISSING"
      );
    }
    return { ...posting, lockedAccount: account };
  });
};

const lockWallets = async (tx, postings, walletGuards = []) => {
  const walletIds = [
    ...new Set(
      postings
        .map((posting) => posting.lockedAccount.walletId)
        .filter(Boolean)
    ),
  ].sort();

  if (walletIds.length === 0) return new Map();

  const wallets = await tx.$queryRaw(Prisma.sql`
    SELECT "id", "balance", "currency", "isActive"
    FROM "Wallet"
    WHERE "id" IN (${Prisma.join(walletIds)})
    ORDER BY "id"
    FOR UPDATE
  `);
  const byId = new Map(wallets.map((wallet) => [wallet.id, wallet]));

  for (const walletId of walletIds) {
    const wallet = byId.get(walletId);
    if (!wallet) {
      throw ApiError.conflict("A required wallet does not exist", "WALLET_NOT_FOUND");
    }
    const guard = walletGuards.find((candidate) => candidate.walletId === walletId);
    if (guard?.requireActive && !wallet.isActive) {
      throw ApiError.conflict(
        "Wallet is inactive",
        "WALLET_INACTIVE"
      );
    }
  }

  return byId;
};

const applyWalletProjection = async (tx, postings) => {
  const deltas = new Map();
  for (const posting of postings) {
    const walletId = posting.lockedAccount.walletId;
    if (!walletId) continue;
    const normal = posting.lockedAccount.normalBalance;
    const rawDelta =
      posting.direction === normal ? posting.cents : -posting.cents;
    deltas.set(walletId, (deltas.get(walletId) || 0n) + rawDelta);
  }

  for (const walletId of [...deltas.keys()].sort()) {
    const delta = deltas.get(walletId);
    if (delta === 0n) continue;

    if (delta > 0n) {
      await tx.wallet.updateMany({
        where: { id: walletId },
        data: { balance: { increment: new Prisma.Decimal(fromMinorUnits(delta)) } },
      });
    } else {
      const amount = fromMinorUnits(-delta);
      const updated = await tx.wallet.updateMany({
        where: {
          id: walletId,
          balance: { gte: new Prisma.Decimal(amount) },
        },
        data: { balance: { decrement: new Prisma.Decimal(amount) } },
      });
      if (updated.count !== 1) {
        throw ApiError.conflict(
          "Insufficient wallet balance",
          "INSUFFICIENT_FUNDS"
        );
      }
    }
  }
};

const postEntry = async ({
  tx,
  eventType,
  eventRef,
  currency,
  description = null,
  metadata = null,
  createdByUserId = null,
  transactionId = null,
  withdrawalId = null,
  reversalOfId = null,
  postings,
  walletGuards = [],
}) => {
  assertTransaction(tx);
  if (typeof eventType !== "string" || !eventType.trim()) {
    throw new TypeError("Journal entry eventType is required");
  }
  if (typeof eventRef !== "string" || !eventRef.trim()) {
    throw new TypeError("Journal entry eventRef is required");
  }
  if (typeof currency !== "string" || !CURRENCY_PATTERN.test(currency)) {
    throw ApiError.badRequest(
      "Journal entry currency must be a three-letter code",
      "LEDGER_CURRENCY_INVALID"
    );
  }

  const normalized = normalizePostings(postings, currency);
  const resolved = await resolveAccounts(tx, normalized.postings, currency);
  const locked = await lockAccounts(tx, resolved);
  const wallets = await lockWallets(tx, locked, walletGuards);

  // Validate balances before writing. The database trigger and deferred
  // constraint checks repeat these invariants independently.
  for (const posting of locked) {
    const accountBalance = decimalStringToMinorUnits(
      String(posting.lockedAccount.balance)
    );
    const normal = posting.lockedAccount.normalBalance;
    const delta = posting.direction === normal ? posting.cents : -posting.cents;
    const walletId = posting.lockedAccount.walletId;

    // Customer wallet liabilities may never be negative. Platform clearing,
    // fee, reserve, and equity accounts are allowed to swing negative because
    // they represent internal positions, not customer funds.
    if (walletId && accountBalance + delta < 0n) {
      throw ApiError.conflict(
        "Insufficient wallet balance",
        "INSUFFICIENT_FUNDS"
      );
    }

    if (walletId) {
      const wallet = wallets.get(walletId);
      if (!wallet) {
        throw ApiError.conflict("A required wallet does not exist", "WALLET_NOT_FOUND");
      }
      if (wallet.currency !== currency) {
        throw ApiError.conflict(
          "Wallet currency does not match the ledger entry",
          "CURRENCY_MISMATCH"
        );
      }
      const projected = decimalStringToMinorUnits(String(wallet.balance));
      if (projected !== accountBalance) {
        throw ApiError.conflict(
          "Wallet balance and ledger balance are inconsistent",
          "LEDGER_WALLET_MISMATCH"
        );
      }
    }
  }

  const entry = await tx.journalEntry.create({
    data: {
      reference: newReference("JRN"),
      eventType,
      eventRef,
      status: "POSTED",
      currency,
      description,
      metadata: metadata ?? undefined,
      createdByUserId,
      transactionId,
      withdrawalId,
      reversalOfId,
    },
    select: {
      id: true,
      reference: true,
      eventType: true,
      eventRef: true,
      status: true,
      currency: true,
      postedAt: true,
    },
  });

  await tx.ledgerPosting.createMany({
    data: locked.map((posting) => ({
      journalEntryId: entry.id,
      ledgerAccountId: posting.lockedAccount.id,
      direction: posting.direction,
      amount: new Prisma.Decimal(posting.amount),
      currency,
    })),
  });

  await applyWalletProjection(tx, locked);

  return {
    ...entry,
    debitTotal: fromMinorUnits(normalized.debitCents),
    creditTotal: fromMinorUnits(normalized.creditCents),
    postings: locked.map((posting) => ({
      accountId: posting.lockedAccount.id,
      accountCode: posting.account.code,
      direction: posting.direction,
      amount: posting.amount,
      currency,
    })),
  };
};

const findOriginalEntry = async (tx, transactionId) =>
  tx.journalEntry.findUnique({
    where: { transactionId },
    include: {
      postings: {
        include: { ledgerAccount: true },
      },
    },
  });

const reverseTransaction = async ({
  tx,
  transaction,
  amount = null,
  reason,
  actorUserId,
  idempotencyKey,
}) => {
  assertTransaction(tx);

  if (typeof reason !== "string" || reason.trim().length < 5) {
    throw ApiError.validation({
      reason: "A reversal reason of at least 5 characters is required",
    });
  }
  const normalizedReason = reason.trim();
  if (!idempotencyKey) {
    throw ApiError.validation({
      idempotencyKey: "An idempotency key is required for reversals",
    });
  }
  if (transaction.status === "LEGACY") {
    throw ApiError.conflict(
      "Legacy pre-ledger transactions cannot be reversed through the ledger",
      "LEGACY_TRANSACTION"
    );
  }
  if (transaction.type !== "TRANSFER") {
    throw ApiError.conflict(
      "Only internal transfers support internal reversal; provider refunds are not available",
      "PROVIDER_REFUND_UNSUPPORTED"
    );
  }

  // Idempotent replay must be resolved before the terminal-status check,
  // otherwise retrying a completed reversal returns 409 instead of the
  // original result. A key reused with different parameters is a conflict.
  const existing = await tx.transactionReversal.findUnique({
    where: {
      transactionId_idempotencyKey: {
        transactionId: transaction.id,
        idempotencyKey,
      },
    },
    include: { journalEntry: true },
  });
  if (existing) {
    const existingCents = toMinorUnits(String(existing.amount));
    const metadata = existing.journalEntry?.metadata;
    const amountOmitted =
      metadata !== null &&
      typeof metadata === "object" &&
      metadata.amountProvided === false;
    // A request that omitted the amount reverses whatever remained at the time.
    // After a partial reversal the recovered row no longer equals the original
    // amount, so the recorded metadata is authoritative for a null request.
    const requestedMatches =
      amount === null
        ? amountOmitted ||
          existingCents === toMinorUnits(String(transaction.amount))
        : existingCents === toMinorUnits(amount);
    if (!requestedMatches || existing.reason !== normalizedReason) {
      throw ApiError.conflict(
        "Idempotency key was already used for a different reversal",
        "IDEMPOTENCY_KEY_REUSED"
      );
    }
    return { reversal: existing, replayed: true };
  }

  if (transaction.status === "REVERSED") {
    throw ApiError.conflict(
      "Transaction has already been fully reversed",
      "TRANSACTION_ALREADY_REVERSED"
    );
  }

  const amountCents = toMinorUnits(String(transaction.amount));
  const reversedCents = decimalStringToMinorUnits(String(transaction.reversedAmount));
  const remainingCents = amountCents - reversedCents;
  const requestedCents = amount === null ? remainingCents : toMinorUnits(amount);

  if (requestedCents <= 0n) {
    throw ApiError.badRequest(
      "Reversal amount must be positive",
      "INVALID_REVERSAL_AMOUNT"
    );
  }
  if (requestedCents > remainingCents) {
    throw ApiError.conflict(
      "Reversal amount exceeds the remaining reversed amount",
      "REVERSAL_EXCEEDS_REMAINING"
    );
  }

  const original = await findOriginalEntry(tx, transaction.id);
  if (!original) {
    throw ApiError.conflict(
      "Transaction does not have a ledger entry",
      "LEDGER_ENTRY_MISSING"
    );
  }

  const sourcePosting = original.postings.find(
    (posting) =>
      posting.ledgerAccount.walletId === transaction.sourceWalletId &&
      posting.direction === "DEBIT"
  );
  const destinationPosting = original.postings.find(
    (posting) =>
      posting.ledgerAccount.walletId === transaction.destinationWalletId &&
      posting.direction === "CREDIT"
  );
  const feePosting = original.postings.find(
    (posting) => posting.ledgerAccount.code === ACCOUNT_CODES.FEE_REVENUE
  );
  if (!sourcePosting || !destinationPosting) {
    throw ApiError.conflict(
      "Original ledger entry does not contain the expected wallet postings",
      "LEDGER_ENTRY_INVALID"
    );
  }

  const feeCents = decimalStringToMinorUnits(String(transaction.feeAmount));
  const completes = reversedCents + requestedCents === amountCents;
  const reversalPostings = [
    {
      accountId: destinationPosting.ledgerAccountId,
      direction: "DEBIT",
      amount: fromMinorUnits(requestedCents),
    },
    {
      accountId: sourcePosting.ledgerAccountId,
      direction: "CREDIT",
      amount: fromMinorUnits(requestedCents + (completes ? feeCents : 0n)),
    },
  ];
  if (completes && feeCents > 0n) {
    if (!feePosting) {
      throw ApiError.conflict(
        "Original ledger entry is missing the fee posting",
        "LEDGER_ENTRY_INVALID"
      );
    }
    reversalPostings.push({
      accountId: feePosting.ledgerAccountId,
      direction: "DEBIT",
      amount: fromMinorUnits(feeCents),
    });
  }

  const entry = await postEntry({
    tx,
    eventType: "REVERSAL",
    eventRef: `reversal:${transaction.id}:${idempotencyKey}`,
    currency: transaction.currency,
    description: `Reversal for transaction ${transaction.reference}`,
    metadata: {
      transactionReference: transaction.reference,
      reason: normalizedReason,
      actorUserId,
      amountProvided: amount !== null,
    },
    createdByUserId: actorUserId,
    reversalOfId: original.id,
    postings: reversalPostings,
  });

  const reversal = await tx.transactionReversal.create({
    data: {
      reference: newReference("REV"),
      transactionId: transaction.id,
      journalEntryId: entry.id,
      amount: new Prisma.Decimal(fromMinorUnits(requestedCents)),
      currency: transaction.currency,
      reason: normalizedReason,
      actorUserId,
      idempotencyKey,
    },
  });

  const nextReversedCents = reversedCents + requestedCents;
  const updated = await tx.transaction.update({
    where: { id: transaction.id },
    data: {
      reversedAmount: new Prisma.Decimal(fromMinorUnits(nextReversedCents)),
      status: nextReversedCents === amountCents ? "REVERSED" : "PARTIALLY_REVERSED",
    },
  });

  return {
    reversal: { ...reversal, journalEntry: entry },
    transaction: updated,
    replayed: false,
  };
};

module.exports = {
  ACCOUNT_CODES,
  postEntry,
  reverseTransaction,
  findOriginalEntry,
  normalizePostings,
};
