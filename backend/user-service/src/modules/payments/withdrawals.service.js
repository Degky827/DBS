const crypto = require("crypto");
const { Prisma } = require("@prisma/client");

const prisma = require("../../config/database");
const ApiError = require("../../utils/ApiError");
const audit = require("../../utils/audit");
const ledger = require("../ledger/ledger.service");
const policies = require("../policies/policies.service");
const {
  toAmountString,
  toMinorUnits,
} = require("../wallets/money");

const formatWithdrawal = (withdrawal) => ({
  id: withdrawal.id,
  reference: withdrawal.reference,
  status: withdrawal.status,
  amount: withdrawal.amount.toFixed(2),
  currency: withdrawal.currency,
  walletId: withdrawal.walletId,
  businessDate: withdrawal.businessDate,
  ledgerEntryReference: withdrawal.journalEntry?.reference ?? null,
  failureReason: withdrawal.failureReason,
  createdAt: withdrawal.createdAt,
  updatedAt: withdrawal.updatedAt,
});

const isSerializationConflict = (error) =>
  error.code === "P2034" ||
  (error.code === "P2010" &&
    error.meta?.driverAdapterError?.cause?.originalCode === "40001");

const findByIdempotencyKey = (userId, idempotencyKey) =>
  prisma.withdrawal.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey } },
    include: { journalEntry: { select: { reference: true } } },
  });

const verifyReplay = (withdrawal, { walletId, amount }) => {
  if (
    withdrawal.walletId !== walletId ||
    withdrawal.amount.toFixed(2) !== amount
  ) {
    throw ApiError.conflict(
      "Idempotency key was already used for a different withdrawal",
      "IDEMPOTENCY_KEY_REUSED"
    );
  }
  return { withdrawal: formatWithdrawal(withdrawal), replayed: true };
};

const initiateWithdrawal = async ({ userId, amount, idempotencyKey }) => {
  const amountString = toAmountString(amount);
  const wallet = await prisma.wallet.findUnique({
    where: { userId },
    select: { id: true, currency: true, isActive: true },
  });
  if (!wallet) {
    throw ApiError.notFound("Wallet not found", "WALLET_NOT_FOUND");
  }
  if (!wallet.isActive) {
    throw ApiError.conflict("Wallet is inactive", "WALLET_INACTIVE");
  }

  const principalCents = toMinorUnits(amountString);
  const policy = await policies.getPolicy(prisma, "WITHDRAWAL", wallet.currency);
  policies.assertAmountWithinPolicy(policy, principalCents);
  if (policies.calculateFeeCents(policy, principalCents) > 0n) {
    throw ApiError.conflict(
      "Withdrawal fees cannot be applied until a payout provider is integrated",
      "WITHDRAWAL_FEE_UNSUPPORTED"
    );
  }

  const existing = await findByIdempotencyKey(userId, idempotencyKey);
  if (existing) {
    return verifyReplay(existing, {
      walletId: wallet.id,
      amount: amountString,
    });
  }

  const attempt = () =>
    prisma.$transaction(
      async (tx) => {
        const replay = await tx.withdrawal.findUnique({
          where: { userId_idempotencyKey: { userId, idempotencyKey } },
          include: { journalEntry: { select: { reference: true } } },
        });
        if (replay) {
          return verifyReplay(replay, {
            walletId: wallet.id,
            amount: amountString,
          });
        }

        const businessDate = policies.businessDateFor(policy.timezone);
        await policies.assertWithinDailyLimits({
          tx,
          userId,
          type: "WITHDRAWAL",
          policy,
          principalCents,
          businessDate,
        });

        const withdrawal = await tx.withdrawal.create({
          data: {
            reference: `w_${crypto.randomBytes(12).toString("base64url")}`,
            userId,
            walletId: wallet.id,
            amount: new Prisma.Decimal(amountString),
            currency: wallet.currency,
            status: "PENDING",
            businessDate: new Date(`${businessDate}T00:00:00.000Z`),
            idempotencyKey,
          },
        });

        const entry = await ledger.postEntry({
          tx,
          eventType: "WITHDRAWAL_RESERVATION",
          eventRef: `withdrawal:${withdrawal.id}`,
          currency: wallet.currency,
          description: `Withdrawal reservation ${withdrawal.reference}`,
          metadata: {
            withdrawalReference: withdrawal.reference,
            walletId: wallet.id,
            payoutProviderIntegrated: false,
          },
          createdByUserId: userId,
          withdrawalId: withdrawal.id,
          postings: [
            {
              accountCode: `WALLET:${wallet.id}`,
              direction: "DEBIT",
              amount: amountString,
            },
            {
              accountCode: ledger.ACCOUNT_CODES.WITHDRAWAL_RESERVED,
              direction: "CREDIT",
              amount: amountString,
            },
          ],
          walletGuards: [{ walletId: wallet.id, requireActive: true }],
        });

        return {
          withdrawal: formatWithdrawal({
            ...withdrawal,
            journalEntry: { reference: entry.reference },
          }),
          replayed: false,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

  for (let attemptCount = 0; attemptCount < 4; attemptCount += 1) {
    try {
      const result = await attempt();
      if (!result.replayed) {
        audit("WITHDRAWAL_RESERVED", {
          userId,
          withdrawalReference: result.withdrawal.reference,
          amount: result.withdrawal.amount,
          currency: result.withdrawal.currency,
          payoutProviderIntegrated: false,
        });
      }
      return result;
    } catch (error) {
      const serializationConflict = isSerializationConflict(error);
      if (serializationConflict && attemptCount < 3) continue;

      if (error.code === "P2002" || serializationConflict) {
        const committed = await findByIdempotencyKey(userId, idempotencyKey);
        if (committed) {
          return verifyReplay(committed, {
            walletId: wallet.id,
            amount: amountString,
          });
        }
      }
      if (serializationConflict) {
        throw ApiError.conflict(
          "Withdrawal could not be reserved due to concurrent activity; retry with the same idempotency key",
          "WITHDRAWAL_RETRY"
        );
      }
      throw error;
    }
  }

  throw ApiError.conflict(
    "Withdrawal could not be reserved; retry with the same idempotency key",
    "WITHDRAWAL_RETRY"
  );
};

const cancelWithdrawal = async ({ userId, reference, reason = null }) => {
  return prisma.$transaction(
    async (tx) => {
      const locked = await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "Withdrawal" WHERE "reference" = ${reference} FOR UPDATE
      `);
      if (!locked[0]) {
        throw ApiError.notFound("Withdrawal not found", "WITHDRAWAL_NOT_FOUND");
      }

      const withdrawal = await tx.withdrawal.findUnique({
        where: { id: locked[0].id },
        include: { journalEntry: { select: { reference: true } } },
      });
      if (!withdrawal || withdrawal.userId !== userId) {
        throw ApiError.notFound("Withdrawal not found", "WITHDRAWAL_NOT_FOUND");
      }
      if (withdrawal.status === "CANCELLED") {
        return {
          withdrawal: formatWithdrawal(withdrawal),
          replayed: true,
        };
      }
      if (withdrawal.status !== "PENDING") {
        throw ApiError.conflict(
          "Only pending withdrawals can be cancelled",
          "WITHDRAWAL_NOT_CANCELLABLE"
        );
      }

      const original = await tx.journalEntry.findUnique({
        where: { withdrawalId: withdrawal.id },
      });
      if (!original) {
        throw ApiError.conflict(
          "Withdrawal reservation ledger entry is missing",
          "LEDGER_ENTRY_MISSING"
        );
      }

      await ledger.postEntry({
        tx,
        eventType: "WITHDRAWAL_CANCELLATION",
        eventRef: `withdrawal-cancel:${withdrawal.id}`,
        currency: withdrawal.currency,
        description: `Withdrawal cancellation ${withdrawal.reference}`,
        metadata: {
          withdrawalReference: withdrawal.reference,
          reason,
        },
        createdByUserId: userId,
        reversalOfId: original.id,
        postings: [
          {
            accountCode: ledger.ACCOUNT_CODES.WITHDRAWAL_RESERVED,
            direction: "DEBIT",
            amount: withdrawal.amount.toFixed(2),
          },
          {
            accountCode: `WALLET:${withdrawal.walletId}`,
            direction: "CREDIT",
            amount: withdrawal.amount.toFixed(2),
          },
        ],
      });

      const updated = await tx.withdrawal.update({
        where: { id: withdrawal.id },
        data: { status: "CANCELLED" },
      });

      audit("WITHDRAWAL_CANCELLED", {
        userId,
        withdrawalReference: withdrawal.reference,
        amount: withdrawal.amount.toFixed(2),
        currency: withdrawal.currency,
      });

      return {
        withdrawal: formatWithdrawal({
          ...updated,
          journalEntry: withdrawal.journalEntry,
        }),
        replayed: false,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
};

const getWithdrawal = async (userId, reference) => {
  const withdrawal = await prisma.withdrawal.findFirst({
    where: { reference, userId },
    include: { journalEntry: { select: { reference: true } } },
  });
  if (!withdrawal) {
    throw ApiError.notFound("Withdrawal not found", "WITHDRAWAL_NOT_FOUND");
  }
  return { withdrawal: formatWithdrawal(withdrawal) };
};

module.exports = {
  initiateWithdrawal,
  cancelWithdrawal,
  getWithdrawal,
  formatWithdrawal,
};
