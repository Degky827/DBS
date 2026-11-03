const { Prisma } = require("@prisma/client");

const ApiError = require("../../utils/ApiError");
const { decimalStringToMinorUnits, fromMinorUnits } = require("../wallets/money");

// The operations a KYC tier can gate. These are the codes kyc-service stores
// in KycTierLimit.operation; a name missing from that table means the tier
// authorizes nothing, never that the amount is unlimited.
const TIER_OPERATIONS = Object.freeze([
  "DEPOSIT",
  "TRANSFER",
  "WITHDRAWAL",
  "PAYOUT",
  "SCHEDULED_TRANSFER",
]);

const OPERATION_LABELS = Object.freeze({
  DEPOSIT: "deposits",
  TRANSFER: "transfers",
  WITHDRAWAL: "withdrawals",
  PAYOUT: "external payouts",
  SCHEDULED_TRANSFER: "scheduled transfers",
});

// Only deposits raise the acting customer's own balance, so only they can
// breach a tier's maximum-balance ceiling.
const CREDITING_OPERATIONS = Object.freeze(["DEPOSIT"]);

const MAX_OCCURRENCES = Object.freeze({
  ONCE: { day: 1, month: 1 },
  DAILY: { day: 1, month: 31 },
  WEEKLY: { day: 1, month: 5 },
  MONTHLY: { day: 1, month: 1 },
});

const cents = (value) =>
  value === null || value === undefined ? null : decimalStringToMinorUnits(String(value));

const tierLabel = (tier) =>
  `verification level ${tier.code}${Number.isInteger(tier.version) ? ` v${tier.version}` : ""}`;

const breach = (message, code, decision) =>
  ApiError.conflict(message, code, {
    tierCode: decision.tier.code,
    tierVersion: decision.tier.version,
    tierSource: decision.tier.source,
    operation: decision.operation,
    currency: decision.currency,
    ...decision.details,
  });

// The limit row that authorizes this operation in this currency. Returning null
// means there is no tier to enforce, which is deliberately different from an
// empty tier: a caller with no tier context keeps the platform policy alone,
// while a tier that simply lacks this row is a denial (see limitFor).
const tierOf = (kyc) => (kyc && kyc.tier ? kyc.tier : null);

const enforcementReason = (kyc) => {
  if (!kyc) return "NO_KYC_CONTEXT";
  if (!kyc.tier) return "TIER_NOT_CONFIGURED";
  return null;
};

const limitFor = (kyc, operation, currency) => {
  if (!TIER_OPERATIONS.includes(operation)) {
    throw ApiError.internal(`Unknown tier-gated operation ${operation}`);
  }
  const tier = tierOf(kyc);
  if (!tier) return null;

  const allowed =
    Array.isArray(tier.allowedOperations) && tier.allowedOperations.includes(operation);
  const limit = (tier.limits || []).find(
    (row) => row.operation === operation && row.currency === currency
  );

  if (!allowed || !limit || limit.isAllowed === false) {
    throw ApiError.forbidden(
      `Your ${tierLabel(tier)} does not allow ${OPERATION_LABELS[operation]} in ${currency}. Request a higher verification level to continue.`,
      "TIER_OPERATION_NOT_ALLOWED",
      {
        tierCode: tier.code,
        tierVersion: tier.version,
        tierSource: tier.source,
        operation,
        currency,
      }
    );
  }
  return { ...limit, tier };
};

const assertAmountWithinTierLimit = (limit, amountCents) => {
  const min = cents(limit.minAmount);
  const max = cents(limit.maxAmount);
  if (min !== null && amountCents < min) {
    throw ApiError.conflict(
      `Each ${OPERATION_LABELS[limit.operation]} at your ${tierLabel(limit.tier)} must be at least ${fromMinorUnits(min)} ${limit.currency}`,
      "TIER_AMOUNT_LIMIT_EXCEEDED",
      {
        tierCode: limit.tier.code,
        tierVersion: limit.tier.version,
        tierSource: limit.tier.source,
        operation: limit.operation,
        currency: limit.currency,
        minimum: fromMinorUnits(min),
      }
    );
  }
  if (max !== null && amountCents > max) {
    throw ApiError.conflict(
      `Amount exceeds the per-${OPERATION_LABELS[limit.operation]} limit of your ${tierLabel(limit.tier)} (${fromMinorUnits(max)} ${limit.currency})`,
      "TIER_AMOUNT_LIMIT_EXCEEDED",
      {
        tierCode: limit.tier.code,
        tierVersion: limit.tier.version,
        tierSource: limit.tier.source,
        operation: limit.operation,
        currency: limit.currency,
        limit: fromMinorUnits(max),
      }
    );
  }
};

// Prisma.raw is used only with literals defined below, never with input.
const usageSource = (operation) => {
  if (operation === "DEPOSIT") {
    return {
      table: Prisma.raw('"Payment"'),
      actor: Prisma.raw('"userId"'),
      filter: Prisma.sql`"type" = 'DEPOSIT' AND "status" IN ('PENDING', 'COMPLETED')`,
      total: Prisma.raw('COALESCE(SUM("amount"), 0)'),
    };
  }
  if (operation === "WITHDRAWAL") {
    return {
      table: Prisma.raw('"Withdrawal"'),
      actor: Prisma.raw('"userId"'),
      filter: Prisma.sql`"status" = 'PENDING'`,
      total: Prisma.raw('COALESCE(SUM("amount"), 0)'),
    };
  }
  if (operation === "TRANSFER") {
    return {
      table: Prisma.raw('"Transaction"'),
      actor: Prisma.raw('"initiatedByUserId"'),
      filter: Prisma.sql`"type" = 'TRANSFER' AND "status" IN ('POSTED', 'PARTIALLY_REVERSED')`,
      total: Prisma.raw('COALESCE(SUM("amount" + "feeAmount" - "reversedAmount"), 0)'),
    };
  }
  // PAYOUT and SCHEDULED_TRANSFER have no usage table the platform can sum yet:
  // payouts are created by the provider integration and scheduled runs are
  // recorded as TRANSFER rows. They are gated per transaction here, and the
  // recurring volume of a schedule is projected when the schedule is created.
  return null;
};

const periodPredicate = (period, businessDate) =>
  period === "day"
    ? Prisma.sql`"businessDate" = ${businessDate}::date`
    : Prisma.sql`"businessDate" >= date_trunc('month', ${businessDate}::date)
        AND "businessDate" < date_trunc('month', ${businessDate}::date) + interval '1 month'`;

const usedInPeriod = async (tx, { userId, operation, businessDate, period }) => {
  const source = usageSource(operation);
  if (!source) return null;
  const rows = await tx.$queryRaw(Prisma.sql`
    SELECT ${source.total}::text AS total, COUNT(*)::int AS count
    FROM ${source.table}
    WHERE ${source.actor} = ${userId}
      AND ${source.filter}
      AND ${periodPredicate(period, businessDate)}
  `);
  return {
    amountCents: decimalStringToMinorUnits(rows[0]?.total ?? "0"),
    count: Number(rows[0]?.count ?? 0),
  };
};

const lockPeriod = (tx, key) =>
  tx.$executeRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))
  `);

const walletBalanceCents = async (tx, walletId) => {
  const wallet = await tx.wallet.findUnique({
    where: { id: walletId },
    select: { balance: true },
  });
  return decimalStringToMinorUnits(String(wallet?.balance ?? "0"));
};

// Deposits still awaiting the provider are not in the balance yet but are
// already authorized, so they count toward the ceiling. A Payment carries no
// fee column, so the projection uses the gross amount, which overstates rather
// than understates what the balance is about to become.
const pendingCreditCents = async (tx, userId) => {
  const rows = await tx.$queryRaw(Prisma.sql`
    SELECT COALESCE(SUM("amount"), 0)::text AS total
    FROM "Payment"
    WHERE "userId" = ${userId}
      AND "type" = 'DEPOSIT'
      AND "status" = 'PENDING'
  `);
  return decimalStringToMinorUnits(rows[0]?.total ?? "0");
};

// Everything a tier says about one pending operation, in minor units, with the
// already-consumed periods read inside the caller's transaction so a replay or
// a concurrent request cannot slip past a ceiling. Returns the decision (for
// the audit snapshot) or null when no tier applies.
const assertWithinTierLimits = async ({
  tx,
  userId,
  kyc,
  operation,
  currency,
  walletId,
  amountCents,
  feeCents = 0n,
  netCents = null,
  businessDate,
}) => {
  const limit = limitFor(kyc, operation, currency);
  if (!limit) return null;
  assertAmountWithinTierLimit(limit, amountCents);

  const tier = limit.tier;
  const consumption = amountCents + feeCents;
  const decision = {
    tier,
    operation,
    currency,
    limit,
    daily: null,
    monthly: null,
    details: {},
  };

  const dailyLimit = cents(limit.dailyAmount);
  const monthlyLimit = cents(limit.monthlyAmount);
  const balanceLimit = cents(limit.maxBalance);
  // PAYOUT and SCHEDULED_TRANSFER have no usage table to sum yet, so their
  // period ceilings are not evaluated here (see usageSource).
  const hasHistory = usageSource(operation) !== null;
  const needsDaily = hasHistory && (dailyLimit !== null || Number.isInteger(limit.dailyCount));
  const needsMonthly = hasHistory && monthlyLimit !== null;

  if (needsDaily || needsMonthly || balanceLimit !== null) {
    // Same key policies.service takes for this user, operation and day, so the
    // two limit systems serialize on one lock rather than racing each other.
    // The balance projection needs it too: two deposits authorized on the same
    // day must not both read the pre-deposit balance.
    await lockPeriod(tx, `${userId}:${operation}:${businessDate}`);
  }

  if (needsDaily) {
    decision.daily = await usedInPeriod(tx, {
      userId,
      operation,
      businessDate,
      period: "day",
    });
    if (dailyLimit !== null && decision.daily.amountCents + consumption > dailyLimit) {
      decision.details = {
        limit: fromMinorUnits(dailyLimit),
        used: fromMinorUnits(decision.daily.amountCents),
        businessDate,
      };
      throw breach(
        `Daily ${OPERATION_LABELS[operation]} limit of your ${tierLabel(tier)} exceeded`,
        "TIER_DAILY_LIMIT_EXCEEDED",
        decision
      );
    }
    if (Number.isInteger(limit.dailyCount) && decision.daily.count + 1 > limit.dailyCount) {
      decision.details = {
        limit: limit.dailyCount,
        used: decision.daily.count,
        businessDate,
      };
      throw breach(
        `Daily ${OPERATION_LABELS[operation]} count limit of your ${tierLabel(tier)} exceeded`,
        "TIER_DAILY_COUNT_EXCEEDED",
        decision
      );
    }
  }

  if (needsMonthly) {
    // The day lock does not serialize the other days of the month, so the
    // monthly figure takes a month-scoped key of its own.
    await lockPeriod(tx, `${userId}:${operation}:${businessDate.slice(0, 7)}:month`);
    decision.monthly = await usedInPeriod(tx, {
      userId,
      operation,
      businessDate,
      period: "month",
    });
    if (decision.monthly.amountCents + consumption > monthlyLimit) {
      decision.details = {
        limit: fromMinorUnits(monthlyLimit),
        used: fromMinorUnits(decision.monthly.amountCents),
        month: businessDate.slice(0, 7),
      };
      throw breach(
        `Monthly ${OPERATION_LABELS[operation]} limit of your ${tierLabel(tier)} exceeded`,
        "TIER_MONTHLY_LIMIT_EXCEEDED",
        decision
      );
    }
  }

  if (balanceLimit !== null && CREDITING_OPERATIONS.includes(operation)) {
    const balanceCents = await walletBalanceCents(tx, walletId);
    const pending = await pendingCreditCents(tx, userId);
    const credited = netCents === null ? amountCents : netCents;
    if (balanceCents + pending + credited > balanceLimit) {
      decision.details = {
        limit: fromMinorUnits(balanceLimit),
        balance: fromMinorUnits(balanceCents + pending),
        currency,
      };
      throw breach(
        `This deposit would take your balance past the maximum allowed at your ${tierLabel(tier)}`,
        "TIER_MAX_BALANCE_EXCEEDED",
        decision
      );
    }
  }

  return decision;
};

// A schedule is authorized for its whole lifetime when it is created or
// resumed: the recurring volume is projected against the tier's ceilings
// instead of re-read per run, because the worker that executes due schedules
// has no KYC session to resolve the tier against.
const assertScheduleWithinTierLimits = ({ kyc, currency, frequency, amountCents }) => {
  const limit = limitFor(kyc, "SCHEDULED_TRANSFER", currency);
  if (!limit) return null;
  assertAmountWithinTierLimit(limit, amountCents);

  const occurrences = MAX_OCCURRENCES[frequency] || MAX_OCCURRENCES.ONCE;
  const tier = limit.tier;
  const reject = (message, extra) => {
    throw breach(message, "TIER_SCHEDULED_VOLUME_EXCEEDED", {
      tier,
      operation: "SCHEDULED_TRANSFER",
      currency,
      details: { frequency, ...extra },
    });
  };

  const dailyLimit = cents(limit.dailyAmount);
  if (dailyLimit !== null && amountCents * BigInt(occurrences.day) > dailyLimit) {
    reject(`This schedule can move more than your ${tierLabel(tier)} allows in a day`, {
      limit: fromMinorUnits(dailyLimit),
      projected: fromMinorUnits(amountCents * BigInt(occurrences.day)),
    });
  }
  if (Number.isInteger(limit.dailyCount) && occurrences.day > limit.dailyCount) {
    reject(`This schedule runs more often than your ${tierLabel(tier)} allows in a day`, {
      limit: limit.dailyCount,
      projected: occurrences.day,
    });
  }
  const monthlyLimit = cents(limit.monthlyAmount);
  if (monthlyLimit !== null && amountCents * BigInt(occurrences.month) > monthlyLimit) {
    reject(`This schedule can move more than your ${tierLabel(tier)} allows in a month`, {
      limit: fromMinorUnits(monthlyLimit),
      projected: fromMinorUnits(amountCents * BigInt(occurrences.month)),
    });
  }
  return { limit, occurrences, tier, operation: "SCHEDULED_TRANSFER", currency };
};

// Stored on the financial record so an officer can see which tier authorized
// the movement and what the ceilings and usage were at that moment.
const tierSnapshot = (decision, kyc) => {
  if (decision) {
    const { limit, tier, operation, currency, daily, monthly } = decision;
    return {
      enforced: true,
      tierCode: tier.code,
      tierVersion: tier.version,
      tierSource: tier.source,
      operation,
      currency,
      minAmount: limit.minAmount ?? null,
      maxAmount: limit.maxAmount ?? null,
      dailyAmount: limit.dailyAmount ?? null,
      dailyCount: limit.dailyCount ?? null,
      monthlyAmount: limit.monthlyAmount ?? null,
      maxBalance: limit.maxBalance ?? null,
      dailyUsedBefore: daily ? fromMinorUnits(daily.amountCents) : null,
      dailyCountBefore: daily ? daily.count : null,
      monthlyUsedBefore: monthly ? fromMinorUnits(monthly.amountCents) : null,
    };
  }
  return { enforced: false, reason: enforcementReason(kyc) };
};

module.exports = {
  TIER_OPERATIONS,
  limitFor,
  assertAmountWithinTierLimit,
  assertWithinTierLimits,
  assertScheduleWithinTierLimits,
  tierSnapshot,
  enforcementReason,
};
