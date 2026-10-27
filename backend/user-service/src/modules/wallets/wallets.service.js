const { Prisma } = require("@prisma/client");
const prisma = require("../../config/database");
const ApiError = require("../../utils/ApiError");
const { toAmountString } = require("./money");

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
  sourceWalletId: true,
  destinationWalletId: true,
  amount: true,
  createdAt: true,
};

const formatWallet = (wallet) => ({
  id: wallet.id,
  balance: wallet.balance.toFixed(2),
  currency: wallet.currency,
  isActive: wallet.isActive,
  createdAt: wallet.createdAt,
  updatedAt: wallet.updatedAt,
});

const formatTransaction = (transaction) => ({
  id: transaction.id,
  reference: transaction.reference,
  type: transaction.type,
  sourceWalletId: transaction.sourceWalletId,
  destinationWalletId: transaction.destinationWalletId,
  amount: transaction.amount.toFixed(2),
  createdAt: transaction.createdAt,
});

const isSerializationConflict = (error) =>
  error.code === "P2034" ||
  (error.code === "P2010" &&
    error.meta?.driverAdapterError?.cause?.originalCode === "40001");

const createWallet = async (userId) => {
  try {
    const wallet = await prisma.wallet.create({
      data: { userId },
      select: walletFields,
    });
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
    select: { id: true },
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
          select: { id: true },
        });
        if (!destinationWallet) {
          throw ApiError.notFound(
            "Destination wallet not found",
            "WALLET_NOT_FOUND"
          );
        }

        await tx.$queryRaw(Prisma.sql`
          SELECT "id"
          FROM "Wallet"
          WHERE "id" IN (${Prisma.join([sourceWallet.id, destinationWallet.id])})
          ORDER BY "id"
          FOR UPDATE
        `);

        const lockedSource = await tx.wallet.findUnique({
          where: { id: sourceWallet.id },
          select: { currency: true, isActive: true },
        });
        const lockedDestination = await tx.wallet.findUnique({
          where: { id: destinationWallet.id },
          select: { currency: true, isActive: true },
        });
        if (!lockedSource || !lockedDestination) {
          throw ApiError.notFound("Wallet not found", "WALLET_NOT_FOUND");
        }
        if (!lockedSource.isActive || !lockedDestination.isActive) {
          throw ApiError.conflict(
            "Transfers require active source and destination wallets",
            "WALLET_INACTIVE"
          );
        }
        if (lockedSource.currency !== lockedDestination.currency) {
          throw ApiError.conflict(
            "Transfers between different currencies are not supported",
            "CURRENCY_MISMATCH"
          );
        }

        const decimalAmount = new Prisma.Decimal(amountString);
        const debit = await tx.wallet.updateMany({
          where: { id: sourceWallet.id, balance: { gte: decimalAmount } },
          data: { balance: { decrement: decimalAmount } },
        });
        if (debit.count !== 1) {
          throw ApiError.conflict(
            "Insufficient wallet balance",
            "INSUFFICIENT_FUNDS"
          );
        }

        await tx.wallet.update({
          where: { id: destinationWallet.id },
          data: { balance: { increment: decimalAmount } },
        });

        const transaction = await tx.transaction.create({
          data: {
            initiatedByUserId: userId,
            sourceWalletId: sourceWallet.id,
            destinationWalletId: destinationWallet.id,
            amount: decimalAmount,
            idempotencyKey,
          },
          select: transactionFields,
        });

        return { transaction: formatTransaction(transaction), replayed: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await attemptTransfer();
    } catch (error) {
      const serializationConflict = isSerializationConflict(error);
      if (serializationConflict && attempt < 3) continue;

      if (error.code === "P2020") {
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
  listTransactions,
  getTransaction,
};