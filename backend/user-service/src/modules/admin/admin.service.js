const { Prisma } = require("@prisma/client");

const prisma = require("../../config/database");
const ApiError = require("../../utils/ApiError");

const startOfUtcDay = (date) => {
  const value = new Date(date);
  value.setUTCHours(0, 0, 0, 0);
  return value;
};

const periodStart = (days) => {
  const start = startOfUtcDay(new Date());
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start;
};

const dayLabels = (from, days) =>
  Array.from({ length: days }, (_, index) => {
    const day = new Date(from);
    day.setUTCDate(day.getUTCDate() + index);
    return day.toISOString().slice(0, 10);
  });

const decimal = (value) => new Prisma.Decimal(value ?? 0).toFixed(2);

const groupRows = (rows, key = "status") => {
  const counts = new Map(rows.map((row) => [row[key], row._count._all]));
  return [...counts.entries()].map(([value, count]) => ({ value, count }));
};

const volumeRows = (rows) =>
  rows.map((row) => ({
    currency: row.currency,
    amount: decimal(row._sum.amount),
    count: row._count._all,
  }));

const transactionSelect = {
  id: true,
  reference: true,
  type: true,
  status: true,
  currency: true,
  amount: true,
  feeAmount: true,
  reversedAmount: true,
  businessDate: true,
  sourceWalletId: true,
  destinationWalletId: true,
  createdAt: true,
  initiatedBy: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
  payment: {
    select: {
      reference: true,
      provider: true,
      providerRef: true,
      status: true,
      failureReason: true,
    },
  },
};

const formatTransaction = (transaction) => ({
  id: transaction.id,
  reference: transaction.reference,
  type: transaction.type,
  status: transaction.status,
  currency: transaction.currency,
  amount: transaction.amount.toFixed(2),
  feeAmount: transaction.feeAmount.toFixed(2),
  reversedAmount: transaction.reversedAmount.toFixed(2),
  businessDate: transaction.businessDate,
  sourceWalletId: transaction.sourceWalletId,
  destinationWalletId: transaction.destinationWalletId,
  createdAt: transaction.createdAt,
  initiatedBy: transaction.initiatedBy,
  payment: transaction.payment,
});

const transactionWhere = ({ q, type, status, from, to }) => ({
  ...(q ? { reference: { contains: q, mode: "insensitive" } } : {}),
  ...(type ? { type } : {}),
  ...(status ? { status } : {}),
  ...(from || to
    ? {
        createdAt: {
          ...(from ? { gte: new Date(from) } : {}),
          ...(to ? { lte: new Date(to) } : {}),
        },
      }
    : {}),
});

const getOverview = async ({ days }) => {
  const from = periodStart(days);
  const [
    usersTotal,
    usersNew,
    walletsTotal,
    walletsActive,
    transactionsTotal,
    transactionsInPeriod,
    transactionVolumes,
    transactionStatuses,
    paymentsTotal,
    paymentStatuses,
    paymentCurrencies,
    withdrawalsPending,
    reversalsInPeriod,
    policiesConfigured,
  ] = await Promise.all([
    prisma.userProfile.count(),
    prisma.userProfile.count({ where: { createdAt: { gte: from } } }),
    prisma.wallet.count(),
    prisma.wallet.count({ where: { isActive: true } }),
    prisma.transaction.count(),
    prisma.transaction.aggregate({
      where: { createdAt: { gte: from } },
      _count: { _all: true },
      _sum: { amount: true, feeAmount: true },
    }),
    prisma.transaction.groupBy({
      by: ["currency"],
      where: { createdAt: { gte: from } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.transaction.groupBy({
      by: ["status"],
      where: { createdAt: { gte: from } },
      _count: { _all: true },
    }),
    prisma.payment.count(),
    prisma.payment.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.payment.groupBy({
      by: ["currency"],
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.withdrawal.count({ where: { status: "PENDING" } }),
    prisma.transactionReversal.count({ where: { createdAt: { gte: from } } }),
    prisma.financialPolicy.count({ where: { isActive: true } }),
  ]);

  return {
    period: {
      days,
      from: from.toISOString(),
      to: new Date().toISOString(),
    },
    users: { total: usersTotal, newInPeriod: usersNew },
    wallets: { total: walletsTotal, active: walletsActive },
    transactions: {
      total: transactionsTotal,
      inPeriod: transactionsInPeriod._count._all,
      volume: decimal(transactionsInPeriod._sum.amount),
      fees: decimal(transactionsInPeriod._sum.feeAmount),
      byStatus: groupRows(transactionStatuses),
      byCurrency: volumeRows(transactionVolumes),
    },
    payments: {
      total: paymentsTotal,
      byStatus: groupRows(paymentStatuses),
      byCurrency: volumeRows(paymentCurrencies),
    },
    withdrawals: { pending: withdrawalsPending },
    reversals: { inPeriod: reversalsInPeriod },
    policies: { active: policiesConfigured },
  };
};

const getFinancialAnalytics = async ({ days }) => {
  const from = periodStart(days);
  const dates = dayLabels(from, days);

  const [
    transactionDays,
    paymentDays,
    transactionStatuses,
    transactionTypes,
    paymentStatuses,
    transactionCurrency,
    withdrawalsByStatus,
    reversalsInPeriod,
  ] = await Promise.all([
    prisma.$queryRaw`
      SELECT to_char("createdAt", 'YYYY-MM-DD') AS day,
             "currency" AS currency,
             COUNT(*)::int AS count,
             COALESCE(SUM("amount"), 0)::text AS volume
      FROM "Transaction"
      WHERE "createdAt" >= ${from}
      GROUP BY 1, 2
      ORDER BY 1
    `,
    prisma.$queryRaw`
      SELECT to_char("createdAt", 'YYYY-MM-DD') AS day,
             "status" AS status,
             COUNT(*)::int AS count,
             COALESCE(SUM("amount"), 0)::text AS volume
      FROM "Payment"
      WHERE "createdAt" >= ${from}
      GROUP BY 1, 2
      ORDER BY 1
    `,
    prisma.transaction.groupBy({
      by: ["status"],
      where: { createdAt: { gte: from } },
      _count: { _all: true },
    }),
    prisma.transaction.groupBy({
      by: ["type"],
      where: { createdAt: { gte: from } },
      _count: { _all: true },
    }),
    prisma.payment.groupBy({
      by: ["status"],
      where: { createdAt: { gte: from } },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.transaction.groupBy({
      by: ["currency"],
      where: { createdAt: { gte: from } },
      _sum: { amount: true, feeAmount: true },
      _count: { _all: true },
    }),
    prisma.withdrawal.groupBy({
      by: ["status", "currency"],
      where: { createdAt: { gte: from } },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.transactionReversal.groupBy({
      by: ["currency"],
      where: { createdAt: { gte: from } },
      _count: { _all: true },
      _sum: { amount: true },
    }),
  ]);

  const transactionDayMap = new Map();
  for (const row of transactionDays) {
    if (!transactionDayMap.has(row.day)) {
      transactionDayMap.set(row.day, { count: 0, currencies: new Map() });
    }
    const entry = transactionDayMap.get(row.day);
    entry.count += row.count;
    entry.currencies.set(row.currency, row.volume);
  }

  const paymentDayMap = new Map();
  for (const row of paymentDays) {
    if (!paymentDayMap.has(row.day)) paymentDayMap.set(row.day, {});
    paymentDayMap.get(row.day)[row.status] = row.count;
  }

  const transactionsByDay = dates.map((date) => {
    const entry = transactionDayMap.get(date);
    return {
      date,
      count: entry?.count ?? 0,
      volumeByCurrency: entry
        ? [...entry.currencies.entries()].map(([currency, amount]) => ({
            currency,
            amount: decimal(amount),
          }))
        : [],
    };
  });

  const paymentsByDay = dates.map((date) => {
    const entry = paymentDayMap.get(date) ?? {};
    return {
      date,
      completed: entry.COMPLETED ?? 0,
      pending: entry.PENDING ?? 0,
      failed: entry.FAILED ?? 0,
    };
  });

  return {
    period: {
      days,
      from: dates[0],
      to: dates[dates.length - 1],
    },
    transactionsByDay,
    paymentsByDay,
    transactionStatus: groupRows(transactionStatuses),
    transactionTypes: groupRows(transactionTypes, "type"),
    paymentStatus: groupRows(paymentStatuses),
    paymentAmounts: paymentStatuses.map((row) => ({
      value: row.status,
      amount: decimal(row._sum.amount),
    })),
    withdrawals: {
      byStatus: withdrawalsByStatus.map((row) => ({
        value: row.status,
        currency: row.currency,
        count: row._count._all,
        amount: decimal(row._sum.amount),
      })),
    },
    reversals: {
      count: reversalsInPeriod.reduce((sum, row) => sum + row._count._all, 0),
      byCurrency: reversalsInPeriod.map((row) => ({
        currency: row.currency,
        count: row._count._all,
        amount: decimal(row._sum.amount),
      })),
    },
    volumeByCurrency: transactionCurrency.map((row) => ({
      currency: row.currency,
      amount: decimal(row._sum.amount),
      fees: decimal(row._sum.feeAmount),
      count: row._count._all,
    })),
  };
};

const registrationSeries = async ({ days }) => {
  const from = periodStart(days);
  const rows = await prisma.$queryRaw`
    SELECT to_char("createdAt", 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
    FROM "UserProfile"
    WHERE "createdAt" >= ${from}
    GROUP BY 1
    ORDER BY 1
  `;
  const counts = new Map(rows.map((row) => [row.day, row.count]));
  return dayLabels(from, days).map((date) => ({
    date,
    count: counts.get(date) ?? 0,
  }));
};

const getAdminAnalytics = async ({ days }) => {
  const [financial, registrations] = await Promise.all([
    getFinancialAnalytics({ days }),
    registrationSeries({ days }),
  ]);
  return { ...financial, registrations };
};

const userWhere = ({ q, role }) => ({
  ...(role ? { role } : {}),
  ...(q
    ? {
        OR: [
          { firstName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { username: { contains: q, mode: "insensitive" } },
        ],
      }
    : {}),
});

const userListSelect = {
  id: true,
  firstName: true,
  middleName: true,
  lastName: true,
  username: true,
  email: true,
  role: true,
  createdAt: true,
  wallet: {
    select: { id: true, currency: true, isActive: true, createdAt: true },
  },
  _count: {
    select: { transactions: true, payments: true, withdrawals: true },
  },
};

const formatUserListItem = (user) => ({
  id: user.id,
  firstName: user.firstName,
  middleName: user.middleName,
  lastName: user.lastName,
  username: user.username,
  email: user.email,
  role: user.role,
  createdAt: user.createdAt,
  wallet: user.wallet,
  counts: user._count,
});

const listUsers = async (options) => {
  const where = userWhere(options);

  if (options.cursor) {
    const cursorUser = await prisma.userProfile.findFirst({
      where: { id: options.cursor, ...where },
      select: { id: true },
    });
    if (!cursorUser) {
      throw ApiError.badRequest(
        "User cursor is invalid for this filter",
        "INVALID_USER_CURSOR"
      );
    }
  }

  const [rows, total] = await Promise.all([
    prisma.userProfile.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      take: options.limit + 1,
      select: userListSelect,
    }),
    prisma.userProfile.count({ where }),
  ]);

  const hasMore = rows.length > options.limit;
  const users = rows.slice(0, options.limit);
  return {
    users: users.map(formatUserListItem),
    page: {
      limit: options.limit,
      hasMore,
      nextCursor: hasMore ? users[users.length - 1].id : null,
      total,
    },
  };
};

const getUserById = async (userId) => {
  const user = await prisma.userProfile.findUnique({
    where: { id: userId },
    select: {
      id: true,
      firstName: true,
      middleName: true,
      lastName: true,
      username: true,
      email: true,
      phoneNumber: true,
      dateOfBirth: true,
      gender: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      state: true,
      postalCode: true,
      country: true,
      bio: true,
      avatarUrl: true,
      role: true,
      createdAt: true,
      updatedAt: true,
      wallet: {
        select: {
          id: true,
          currency: true,
          isActive: true,
          balance: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      _count: {
        select: { transactions: true, payments: true, withdrawals: true },
      },
    },
  });
  if (!user) {
    throw ApiError.notFound("User not found", "USER_NOT_FOUND");
  }

  const recentTransactions = await prisma.transaction.findMany({
    where: {
      OR: [
        { initiatedByUserId: userId },
        { sourceWallet: { userId } },
        { destinationWallet: { userId } },
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 5,
    select: transactionSelect,
  });

  return {
    user: {
      ...user,
      wallet: user.wallet
        ? { ...user.wallet, balance: user.wallet.balance.toFixed(2) }
        : null,
      counts: user._count,
    },
    recentTransactions: recentTransactions.map(formatTransaction),
  };
};

const listPlatformTransactions = async (options) => {
  const where = transactionWhere(options);

  if (options.cursor) {
    const cursorTransaction = await prisma.transaction.findFirst({
      where: { id: options.cursor, ...where },
      select: { id: true },
    });
    if (!cursorTransaction) {
      throw ApiError.badRequest(
        "Transaction cursor is invalid for this filter",
        "INVALID_TRANSACTION_CURSOR"
      );
    }
  }

  const [rows, total, totals, statuses, types, currencies] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      take: options.limit + 1,
      select: transactionSelect,
    }),
    prisma.transaction.count({ where }),
    prisma.transaction.aggregate({
      where,
      _sum: { amount: true, feeAmount: true },
    }),
    prisma.transaction.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    }),
    prisma.transaction.groupBy({
      by: ["type"],
      where,
      _count: { _all: true },
    }),
    prisma.transaction.groupBy({
      by: ["currency"],
      where,
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);

  const hasMore = rows.length > options.limit;
  const transactions = rows.slice(0, options.limit);
  return {
    transactions: transactions.map(formatTransaction),
    summary: {
      total,
      volume: decimal(totals._sum.amount),
      fees: decimal(totals._sum.feeAmount),
      byStatus: groupRows(statuses),
      byType: groupRows(types, "type"),
      byCurrency: volumeRows(currencies),
    },
    page: {
      limit: options.limit,
      hasMore,
      nextCursor: hasMore ? transactions[transactions.length - 1].id : null,
      total,
    },
  };
};

const getPlatformTransaction = async (reference) => {
  const transaction = await prisma.transaction.findUnique({
    where: { reference },
    select: {
      ...transactionSelect,
      journalEntry: {
        select: {
          reference: true,
          eventType: true,
          status: true,
          postedAt: true,
        },
      },
      reversals: {
        orderBy: { createdAt: "desc" },
        select: {
          reference: true,
          amount: true,
          currency: true,
          reason: true,
          actorUserId: true,
          createdAt: true,
        },
      },
      destinationWallet: { select: { id: true, userId: true } },
      sourceWallet: { select: { id: true, userId: true } },
    },
  });
  if (!transaction) {
    throw ApiError.notFound("Transaction not found", "TRANSACTION_NOT_FOUND");
  }

  return {
    transaction: {
      ...formatTransaction(transaction),
      journalEntry: transaction.journalEntry,
      sourceWallet: transaction.sourceWallet,
      destinationWallet: transaction.destinationWallet,
      reversals: transaction.reversals.map((reversal) => ({
        ...reversal,
        amount: reversal.amount.toFixed(2),
      })),
    },
  };
};

const listPlatformPayments = async (options) => {
  const where = {
    ...(options.status ? { status: options.status } : {}),
    ...(options.from || options.to
      ? {
          createdAt: {
            ...(options.from ? { gte: new Date(options.from) } : {}),
            ...(options.to ? { lte: new Date(options.to) } : {}),
          },
        }
      : {}),
  };

  if (options.cursor) {
    const cursorPayment = await prisma.payment.findFirst({
      where: { id: options.cursor, ...where },
      select: { id: true },
    });
    if (!cursorPayment) {
      throw ApiError.badRequest(
        "Payment cursor is invalid for this filter",
        "INVALID_PAYMENT_CURSOR"
      );
    }
  }

  const [rows, total, statuses] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      take: options.limit + 1,
      select: {
        id: true,
        reference: true,
        provider: true,
        type: true,
        status: true,
        amount: true,
        currency: true,
        failureReason: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        wallet: { select: { id: true, currency: true } },
        transaction: { select: { reference: true, status: true } },
      },
    }),
    prisma.payment.count({ where }),
    prisma.payment.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
      _sum: { amount: true },
    }),
  ]);

  const hasMore = rows.length > options.limit;
  const payments = rows.slice(0, options.limit);
  return {
    payments: payments.map((payment) => ({
      ...payment,
      amount: payment.amount.toFixed(2),
    })),
    summary: {
      total,
      byStatus: statuses.map((row) => ({
        value: row.status,
        count: row._count._all,
        amount: decimal(row._sum.amount),
      })),
    },
    page: {
      limit: options.limit,
      hasMore,
      nextCursor: hasMore ? payments[payments.length - 1].id : null,
      total,
    },
  };
};

const AUDIT_SOURCE_LIMIT = 500;

const listAuditLogs = async (options) => {
  const dateFilter =
    options.from || options.to
      ? {
          createdAt: {
            ...(options.from ? { gte: new Date(options.from) } : {}),
            ...(options.to ? { lte: new Date(options.to) } : {}),
          },
        }
      : {};

  const includePolicies = !options.source || options.source === "FINANCIAL_POLICY";
  const includeReversals =
    !options.source || options.source === "TRANSACTION_REVERSAL";
  const includeReconciliation =
    !options.source || options.source === "PAYMENT_RECONCILIATION";

  const [revisions, reversals, reconciliations] = await Promise.all([
    includePolicies
      ? prisma.financialPolicyRevision.findMany({
          where: {
            ...dateFilter,
            ...(options.actorId ? { changedBy: options.actorId } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: AUDIT_SOURCE_LIMIT,
          select: {
            id: true,
            changedBy: true,
            reason: true,
            createdAt: true,
            policyId: true,
            policy: { select: { type: true, currency: true } },
          },
        })
      : [],
    includeReversals
      ? prisma.transactionReversal.findMany({
          where: {
            ...dateFilter,
            ...(options.actorId ? { actorUserId: options.actorId } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: AUDIT_SOURCE_LIMIT,
          select: {
            id: true,
            reference: true,
            amount: true,
            currency: true,
            reason: true,
            actorUserId: true,
            createdAt: true,
            transaction: { select: { reference: true } },
          },
        })
      : [],
    includeReconciliation && (!options.actorId || options.actorId === "SYSTEM")
      ? prisma.paymentReconciliationRecord.findMany({
          where: dateFilter,
          orderBy: { createdAt: "desc" },
          take: AUDIT_SOURCE_LIMIT,
          select: {
            id: true,
            outcome: true,
            providerStatus: true,
            createdAt: true,
            payment: { select: { reference: true } },
          },
        })
      : [],
  ]);

  const entries = [
    ...revisions.map((revision) => ({
      id: `FINANCIAL_POLICY:${revision.id}`,
      timestamp: revision.createdAt,
      source: "FINANCIAL_POLICY",
      actorId: revision.changedBy,
      action: "FINANCIAL_POLICY_UPDATED",
      target: `${revision.policy.type} ${revision.policy.currency}`,
      outcome: "SUCCESS",
      reference: revision.policyId,
      detail: revision.reason,
    })),
    ...reversals.map((reversal) => ({
      id: `TRANSACTION_REVERSAL:${reversal.id}`,
      timestamp: reversal.createdAt,
      source: "TRANSACTION_REVERSAL",
      actorId: reversal.actorUserId,
      action: "TRANSACTION_REVERSED",
      target: reversal.transaction.reference,
      outcome: "SUCCESS",
      reference: reversal.reference,
      detail: `${reversal.amount.toFixed(2)} ${reversal.currency} — ${reversal.reason}`,
    })),
    ...reconciliations.map((record) => ({
      id: `PAYMENT_RECONCILIATION:${record.id}`,
      timestamp: record.createdAt,
      source: "PAYMENT_RECONCILIATION",
      actorId: "SYSTEM",
      action: "PAYMENT_RECONCILED",
      target: record.payment.reference,
      outcome: record.outcome,
      reference: record.id,
      detail: record.providerStatus ? `Provider: ${record.providerStatus}` : null,
    })),
  ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const total = entries.length;
  const offset = (options.page - 1) * options.limit;
  return {
    logs: entries.slice(offset, offset + options.limit),
    page: {
      page: options.page,
      limit: options.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / options.limit)),
    },
    truncated:
      revisions.length === AUDIT_SOURCE_LIMIT ||
      reversals.length === AUDIT_SOURCE_LIMIT ||
      reconciliations.length === AUDIT_SOURCE_LIMIT,
  };
};

module.exports = {
  getOverview,
  getFinancialAnalytics,
  getAdminAnalytics,
  listUsers,
  getUserById,
  listPlatformTransactions,
  getPlatformTransaction,
  listPlatformPayments,
  listAuditLogs,
};
