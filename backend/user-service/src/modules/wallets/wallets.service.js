const { Prisma } = require("@prisma/client");
const prisma = require("../../config/database");
const ApiError = require("../../utils/ApiError");
const audit = require("../../utils/audit");
const ledger = require("../ledger/ledger.service");
const policies = require("../policies/policies.service");
const {
  toAmountString,
  toMinorUnits,
  fromMinorUnits,
} = require("./money");

const walletFields = {
  id: true,
  balance: true,
  currency: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

const transactionFields = {
  id: true,
  reference: true,
  type: true,
  status: true,
  currency: true,
  sourceWalletId: true,
  destinationWalletId: true,
  amount: true,
  feeAmount: true,
  reversedAmount: true,
  createdAt: true,
  journalEntry: { select: { reference: true } },
};

const formatTransaction = (transaction) => ({
  id: transaction.id,
  reference: transaction.reference,
  type: transaction.type,
  status: transaction.status,
  currency: transaction.currency,
  sourceWalletId: transaction.sourceWalletId,
  destinationWalletId: transaction.destinationWalletId,
  amount: transaction.amount.toFixed(2),
  feeAmount: transaction.feeAmount.toFixed(2),
  reversedAmount: transaction.reversedAmount.toFixed(2),
  ledgerEntryReference: transaction.journalEntry?.reference ?? null,
  createdAt: transaction.createdAt,
});

const formatWallet = (wallet) => ({
  id: wallet.id,
  balance: wallet.balance.toFixed(2),
  currency: wallet.currency,
  isActive: wallet.isActive,
  createdAt: wallet.createdAt,
  updatedAt: wallet.updatedAt,
});

const formatReversal = (reversal) => ({
  id: reversal.id,
  reference: reversal.reference,
  transactionId: reversal.transactionId,
  amount: reversal.amount.toFixed(2),
  currency: reversal.currency,
  reason: reversal.reason,
  actorUserId: reversal.actorUserId,
  ledgerEntryReference: reversal.journalEntry?.reference ?? null,
  createdAt: reversal.createdAt,
});

const isSerializationConflict = (error) => {
  if (error.code === "P2034") return true;
  if (error.code !== "P2010") return false;
  const cause = error.meta?.driverAdapterError?.cause;
  return (
    cause?.originalCode === "40001" ||
    cause?.kind === "SerializationFailure"
  );
};

const isNumericOverflow = (error) => {
  if (error.code === "P2020") return true;
  if (error.code !== "P2010") return false;
  const cause = error.meta?.driverAdapterError?.cause;
  return (
    ["22003", "22008"].includes(cause?.originalCode) ||
    cause?.kind === "NumericValueOutOfRange" ||
    /numeric field overflow|out of range/i.test(error.message || "")
  );
};

const createWallet = async (userId) => {
  try {
    const wallet = await prisma.wallet.create({
      data: { userId },
      select: walletFields,
    });
    audit("WALLET_CREATED", { userId, walletId: wallet.id });
    return { wallet: formatWallet(wallet) };
  } catch (error) {
    if (error.code === "P2002") {
      throw ApiError.conflict(
        "A wallet already exists for this account",
        "WALLET_EXISTS"
      );
    }
    throw error;
  }
};

const getMyWallet = async (userId) => {
  const wallet = await prisma.wallet.findUnique({
    where: { userId },
    select: walletFields,
  });
  if (!wallet) {
    throw ApiError.notFound("Wallet not found", "WALLET_NOT_FOUND");
  }
  return { wallet: formatWallet(wallet) };
};

const getWalletById = async (userId, walletId) => {
  const wallet = await prisma.wallet.findFirst({
    where: { id: walletId, userId },
    select: walletFields,
  });
  if (!wallet) {
    throw ApiError.notFound("Wallet not found", "WALLET_NOT_FOUND");
  }
  return { wallet: formatWallet(wallet) };
};

const findIdempotentTransaction = async (userId, idempotencyKey) =>
  prisma.transaction.findUnique({
    where: {
      initiatedByUserId_idempotencyKey: {
        initiatedByUserId: userId,
        idempotencyKey,
      },
    },
    select: transactionFields,
  });

const verifyIdempotentRequest = (
  transaction,
  { sourceWalletId, destinationWalletId, amount }
) => {
  if (
    transaction.sourceWalletId !== sourceWalletId ||
    transaction.destinationWalletId !== destinationWalletId ||
    transaction.amount.toFixed(2) !== amount
  ) {
    throw ApiError.conflict(
      "Idempotency key was already used for a different transfer",
      "IDEMPOTENCY_KEY_REUSED"
    );
  }
  return { transaction: formatTransaction(transaction), replayed: true };
};

const transfer = async ({
  userId,
  destinationWalletId,
  amount,
  idempotencyKey,
}) => {
  const amountString = toAmountString(amount);
  const sourceWallet = await prisma.wallet.findUnique({
    where: { userId },
    select: { id: true, currency: true },
  });
  if (!sourceWallet) {
    throw ApiError.notFound("Wallet not found", "WALLET_NOT_FOUND");
  }
  if (sourceWallet.id === destinationWalletId) {
    throw ApiError.badRequest("A wallet cannot transfer to itself", "SELF_TRANSFER");
  }

  const verifyRequest = (transaction) =>
    verifyIdempotentRequest(transaction, {
      sourceWalletId: sourceWallet.id,
      destinationWalletId,
      amount: amountString,
    });

  const existing = await findIdempotentTransaction(userId, idempotencyKey);
  if (existing) return verifyRequest(existing);

  const attemptTransfer = () =>
    prisma.$transaction(
      async (tx) => {
        const replay = await tx.transaction.findUnique({
          where: {
            initiatedByUserId_idempotencyKey: {
              initiatedByUserId: userId,
              idempotencyKey,
            },
          },
          select: transactionFields,
        });
        if (replay) return verifyRequest(replay);

        const destinationWallet = await tx.wallet.findUnique({
          where: { id: destinationWalletId },
          select: { id: true, currency: true },
        });
        if (!destinationWallet) {
          throw ApiError.notFound(
            "Destination wallet not found",
            "WALLET_NOT_FOUND"
          );
        }

        const principalCents = toMinorUnits(amountString);
        const policy = await policies.getPolicy(
          tx,
          "TRANSFER",
          sourceWallet.currency
        );
        policies.assertAmountWithinPolicy(policy, principalCents);
        const feeCents = policies.calculateFeeCents(policy, principalCents);
        const businessDate = policies.businessDateFor(policy.timezone);
        const decision = await policies.assertWithinDailyLimits({
          tx,
          userId,
          type: "TRANSFER",
          policy,
          principalCents,
          feeCents,
          businessDate,
        });

        let totalCents;
        let feeString;
        try {
          totalCents = principalCents + feeCents;
          feeString = fromMinorUnits(feeCents);
          fromMinorUnits(totalCents);
        } catch {
          throw ApiError.validation({
            amount: "Transfer amount plus fee exceeds the supported range",
          });
        }

        const transaction = await tx.transaction.create({
          data: {
            initiatedByUserId: userId,
            type: "TRANSFER",
            status: "POSTED",
            currency: sourceWallet.currency,
            sourceWalletId: sourceWallet.id,
            destinationWalletId: destinationWallet.id,
            amount: new Prisma.Decimal(amountString),
            feeAmount: new Prisma.Decimal(feeString),
            businessDate: new Date(`${businessDate}T00:00:00.000Z`),
            policySnapshot: policies.policySnapshot(policy, feeCents, decision),
            idempotencyKey,
          },
          select: transactionFields,
        });

        const postings = [
          {
            accountCode: `WALLET:${sourceWallet.id}`,
            direction: "DEBIT",
            amount: fromMinorUnits(totalCents),
          },
          {
            accountCode: `WALLET:${destinationWallet.id}`,
            direction: "CREDIT",
            amount: amountString,
          },
        ];
        if (feeCents > 0n) {
          postings.push({
            accountCode: ledger.ACCOUNT_CODES.FEE_REVENUE,
            direction: "CREDIT",
            amount: feeString,
          });
        }

        const entry = await ledger.postEntry({
          tx,
          eventType: "TRANSFER",
          eventRef: `transaction:${transaction.id}`,
          currency: sourceWallet.currency,
          description: `Wallet transfer ${transaction.reference}`,
          metadata: {
            transactionReference: transaction.reference,
            sourceWalletId: sourceWallet.id,
            destinationWalletId: destinationWallet.id,
          },
          createdByUserId: userId,
          transactionId: transaction.id,
          postings,
          walletGuards: [
            { walletId: sourceWallet.id, requireActive: true },
            { walletId: destinationWallet.id, requireActive: true },
          ],
        });

        return {
          transaction: formatTransaction({
            ...transaction,
            journalEntry: { reference: entry.reference },
          }),
          replayed: false,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const result = await attemptTransfer();
      if (!result.replayed) {
        audit("WALLET_TRANSFER_COMPLETED", {
          userId,
          transactionReference: result.transaction.reference,
          sourceWalletId: sourceWallet.id,
          destinationWalletId,
          amount: result.transaction.amount,
          feeAmount: result.transaction.feeAmount,
          ledgerEntryReference: result.transaction.ledgerEntryReference,
        });
      }
      return result;
    } catch (error) {
      const serializationConflict = isSerializationConflict(error);
      if (serializationConflict && attempt < 3) continue;

      if (isNumericOverflow(error)) {
        throw ApiError.conflict(
          "Destination wallet balance limit exceeded",
          "BALANCE_LIMIT_EXCEEDED"
        );
      }

      if (error.code === "P2002" || serializationConflict) {
        const committed = await findIdempotentTransaction(userId, idempotencyKey);
        if (committed) return verifyRequest(committed);
      }
      if (serializationConflict) {
        throw ApiError.conflict(
          "Transfer could not be completed due to concurrent activity; retry with the same idempotency key",
          "TRANSFER_RETRY"
        );
      }
      throw error;
    }
  }

  throw ApiError.conflict(
    "Transfer could not be completed; retry with the same idempotency key",
    "TRANSFER_RETRY"
  );
};

const reverseTransaction = async ({
  actorUserId,
  reference,
  amount,
  reason,
  idempotencyKey,
}) => {
  const attempt = () =>
    prisma.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "Transaction"
          WHERE "reference" = ${reference}
          FOR UPDATE
        `);
        if (!locked[0]) {
          throw ApiError.notFound("Transaction not found", "TRANSACTION_NOT_FOUND");
        }

        const transaction = await tx.transaction.findUnique({
          where: { id: locked[0].id },
        });
        if (!transaction) {
          throw ApiError.notFound("Transaction not found", "TRANSACTION_NOT_FOUND");
        }

        const result = await ledger.reverseTransaction({
          tx,
          transaction,
          amount,
          reason,
          actorUserId,
          idempotencyKey,
        });

        const current = await tx.transaction.findUnique({
          where: { id: transaction.id },
          select: transactionFields,
        });

        if (result.replayed) {
          return {
            transaction: formatTransaction(current),
            reversal: formatReversal(result.reversal),
            replayed: true,
          };
        }

        return {
          transaction: formatTransaction(current),
          reversal: formatReversal({
            ...result.reversal,
            journalEntry: result.reversal.journalEntry,
          }),
          replayed: false,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

  for (let attemptCount = 0; attemptCount < 4; attemptCount += 1) {
    try {
      const result = await attempt();
      audit(result.replayed ? "TRANSACTION_REVERSAL_REPLAYED" : "TRANSACTION_REVERSED", {
        actorUserId,
        transactionReference: reference,
        reversalReference: result.reversal.reference,
        amount: result.reversal.amount,
        reason,
      });
      return result;
    } catch (error) {
      const serializationConflict = isSerializationConflict(error);
      if (serializationConflict && attemptCount < 3) continue;

      if (error.code === "P2002" || serializationConflict) {
        const transaction = await prisma.transaction.findFirst({
          where: { reference },
          select: { id: true },
        });
        const existing = transaction
          ? await prisma.transactionReversal.findUnique({
              where: {
                transactionId_idempotencyKey: {
                  transactionId: transaction.id,
                  idempotencyKey,
                },
              },
              include: { journalEntry: true },
            })
          : null;
        if (existing && transaction) {
          const amountMatches =
            amount === null ||
            toMinorUnits(String(existing.amount)) === toMinorUnits(String(amount));
          const reasonMatches =
            existing.reason === String(reason ?? "").trim();
          if (!amountMatches || !reasonMatches) {
            throw ApiError.conflict(
              "Idempotency key was already used for a different reversal",
              "IDEMPOTENCY_KEY_REUSED"
            );
          }
          const current = await prisma.transaction.findUnique({
            where: { id: transaction.id },
            select: transactionFields,
          });
          return {
            transaction: formatTransaction(current),
            reversal: formatReversal(existing),
            replayed: true,
          };
        }
      }
      if (serializationConflict) {
        throw ApiError.conflict(
          "Reversal could not be completed due to concurrent activity; retry with the same idempotency key",
          "REVERSAL_RETRY"
        );
      }
      throw error;
    }
  }

  throw ApiError.conflict(
    "Reversal could not be completed; retry with the same idempotency key",
    "REVERSAL_RETRY"
  );
};

const listTransactions = async (userId, options) => {
  const wallet = await prisma.wallet.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!wallet) {
    throw ApiError.notFound("Wallet not found", "WALLET_NOT_FOUND");
  }

  const walletFilter =
    options.direction === "incoming"
      ? { destinationWalletId: wallet.id }
      : options.direction === "outgoing"
        ? { sourceWalletId: wallet.id }
        : {
            OR: [
              { sourceWalletId: wallet.id },
              { destinationWalletId: wallet.id },
            ],
          };
  const dateFilter =
    options.from || options.to
      ? {
          createdAt: {
            ...(options.from ? { gte: new Date(options.from) } : {}),
            ...(options.to ? { lte: new Date(options.to) } : {}),
          },
        }
      : {};
  const where = { ...walletFilter, ...dateFilter };

  if (options.cursor) {
    const cursorTransaction = await prisma.transaction.findFirst({
      where: { id: options.cursor, ...where },
      select: { id: true },
    });
    if (!cursorTransaction) {
      throw ApiError.badRequest(
        "Transaction cursor is invalid for this wallet and filter",
        "INVALID_TRANSACTION_CURSOR"
      );
    }
  }

  const page = await prisma.transaction.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(options.cursor
      ? { cursor: { id: options.cursor }, skip: 1 }
      : {}),
    take: options.limit + 1,
    select: transactionFields,
  });
  const hasMore = page.length > options.limit;
  const transactions = page.slice(0, options.limit);
  return {
    transactions: transactions.map(formatTransaction),
    page: {
      limit: options.limit,
      hasMore,
      nextCursor: hasMore ? transactions[transactions.length - 1].id : null,
    },
  };
};

const getTransaction = async (userId, reference) => {
  const wallet = await prisma.wallet.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!wallet) {
    throw ApiError.notFound("Transaction not found", "TRANSACTION_NOT_FOUND");
  }

  const transaction = await prisma.transaction.findFirst({
    where: {
      reference,
      OR: [{ sourceWalletId: wallet.id }, { destinationWalletId: wallet.id }],
    },
    select: transactionFields,
  });
  if (!transaction) {
    throw ApiError.notFound("Transaction not found", "TRANSACTION_NOT_FOUND");
  }
  return { transaction: formatTransaction(transaction) };
};

module.exports = {
  createWallet,
  getMyWallet,
  getWalletById,
  transfer,
  reverseTransaction,
  listTransactions,
  getTransaction,
  formatTransaction,
};
