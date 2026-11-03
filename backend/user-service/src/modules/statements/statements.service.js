const { Prisma } = require("@prisma/client");
const prisma = require("../../config/database");
const env = require("../../config/env");
const ApiError = require("../../utils/ApiError");

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
};

const zero = () => new Prisma.Decimal(0);

// Net effect of one transaction on the statement wallet. It mirrors the
// history summary rules: deposit fees reduce incoming credit, transfer fees
// are paid by the sender, and a fully reversed transfer refunds its fee.
const netEffect = (transaction, walletId) => {
  let net = zero();
  if (transaction.destinationWalletId === walletId) {
    net = net.plus(transaction.amount).minus(transaction.reversedAmount);
    if (transaction.type === "DEPOSIT") net = net.minus(transaction.feeAmount);
  }
  if (transaction.sourceWalletId === walletId) {
    net = net
      .minus(transaction.amount)
      .minus(transaction.feeAmount)
      .plus(transaction.reversedAmount);
    if (transaction.status === "REVERSED") net = net.plus(transaction.feeAmount);
  }
  return net;
};

const startOfDay = (value) => new Date(`${value}T00:00:00.000Z`);
const endOfDay = (value) => new Date(`${value}T23:59:59.999Z`);

const getStatement = async (userId, { from, to }) => {
  const fromDate = startOfDay(from);
  const toDate = endOfDay(to);
  if (fromDate > toDate) {
    throw ApiError.validation({ from: "from must be before or equal to to" });
  }
  const rangeDays = (toDate - fromDate) / (24 * 60 * 60 * 1000);
  if (rangeDays > env.STATEMENT_MAX_RANGE_DAYS) {
    throw ApiError.validation({
      to: `Statement range cannot exceed ${env.STATEMENT_MAX_RANGE_DAYS} days`,
    });
  }

  const [wallet, user] = await Promise.all([
    prisma.wallet.findUnique({
      where: { userId },
      select: { id: true, currency: true, balance: true, isActive: true },
    }),
    prisma.userProfile.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, email: true },
    }),
  ]);
  if (!wallet) {
    throw ApiError.notFound("Wallet not found", "WALLET_NOT_FOUND");
  }

  const ownership = {
    OR: [{ sourceWalletId: wallet.id }, { destinationWalletId: wallet.id }],
  };
  const [periodTransactions, afterTransactions] = await Promise.all([
    prisma.transaction.findMany({
      where: { ...ownership, createdAt: { gte: fromDate, lte: toDate } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: transactionFields,
    }),
    prisma.transaction.findMany({
      where: { ...ownership, createdAt: { gt: toDate } },
      select: { ...transactionFields },
    }),
  ]);

  const afterNet = afterTransactions.reduce(
    (total, transaction) => total.plus(netEffect(transaction, wallet.id)),
    zero()
  );
  const closingBalance = wallet.balance.minus(afterNet);

  let running = closingBalance;
  const periodNet = periodTransactions.reduce(
    (total, transaction) => total.plus(netEffect(transaction, wallet.id)),
    zero()
  );
  const openingBalance = closingBalance.minus(periodNet);

  running = openingBalance;
  let totalIncoming = zero();
  let totalOutgoing = zero();
  const rows = periodTransactions.map((transaction) => {
    const effect = netEffect(transaction, wallet.id);
    running = running.plus(effect);
    if (effect.isPositive() || effect.isZero()) {
      totalIncoming = totalIncoming.plus(effect);
    } else {
      totalOutgoing = totalOutgoing.plus(effect.abs());
    }
    return {
      reference: transaction.reference,
      type: transaction.type,
      status: transaction.status,
      direction: effect.isNegative() ? "OUTGOING" : "INCOMING",
      amount: effect.abs().toFixed(2),
      signedAmount: effect.toFixed(2),
      balanceAfter: running.toFixed(2),
      currency: transaction.currency,
      createdAt: transaction.createdAt,
    };
  });

  return {
    account: {
      holder: [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Account holder",
      email: user?.email || null,
      walletId: wallet.id,
      currency: wallet.currency,
      isActive: wallet.isActive,
    },
    period: { from, to },
    openingBalance: openingBalance.toFixed(2),
    closingBalance: closingBalance.toFixed(2),
    totals: {
      incoming: totalIncoming.toFixed(2),
      outgoing: totalOutgoing.toFixed(2),
      transactions: rows.length,
    },
    transactions: rows,
  };
};

module.exports = { getStatement, netEffect };
