const { Prisma } = require("@prisma/client");

const prisma = require("../../config/database");
const ApiError = require("../../utils/ApiError");
const audit = require("../../utils/audit");
const {
  toMinorUnits,
  fromMinorUnits,
  decimalStringToMinorUnits,
} = require("../wallets/money");

const POLICY_TYPES = Object.freeze(["TRANSFER", "DEPOSIT", "WITHDRAWAL"]);
const FEE_TYPES = Object.freeze([
  "NONE",
  "FLAT",
  "PERCENTAGE",
  "FLAT_PLUS_PERCENTAGE",
]);

const assertCurrency = (currency) => {
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
    throw ApiError.badRequest(
      "Currency must be a three-letter uppercase code",
      "INVALID_CURRENCY"
    );
  }
};

const assertTimezone = (timezone) => {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
  } catch {
    throw ApiError.validation({ timezone: "Unknown IANA timezone" });
  }
};

const getPolicy = async (tx, type, currency = "ETB") => {
  if (!POLICY_TYPES.includes(type)) {
    throw ApiError.badRequest("Unknown policy type", "INVALID_POLICY_TYPE");
  }
  assertCurrency(currency);

  const policy = await tx.financialPolicy.findFirst({
    where: { type, currency, isActive: true, effectiveFrom: { lte: new Date() } },
    orderBy: { effectiveFrom: "desc" },
  });
  if (!policy) {
    throw ApiError.conflict(
      `No active ${type} policy is configured for ${currency}`,
      "POLICY_NOT_CONFIGURED"
    );
  }
  return policy;
};

const assertAmountWithinPolicy = (policy, amountCents, label = "Amount") => {
  const min = decimalStringToMinorUnits(String(policy.minAmount));
  const max = decimalStringToMinorUnits(String(policy.maxAmount));
  if (amountCents < min || amountCents > max) {
    throw ApiError.validation({
      amount: `${label} must be between ${fromMinorUnits(min)} and ${fromMinorUnits(max)} ${policy.currency}`,
    });
  }
};

const calculateFeeCents = (policy, principalCents) => {
  if (!FEE_TYPES.includes(policy.feeType)) {
    throw ApiError.conflict(
      "Financial policy has an unsupported fee type",
      "INVALID_FEE_POLICY"
    );
  }
  if (policy.feeType === "NONE") return 0n;

  const flat = decimalStringToMinorUnits(String(policy.feeFlat));
  const minimum = decimalStringToMinorUnits(String(policy.feeMin));
  const maximum =
    policy.feeMax === null || policy.feeMax === undefined
      ? null
      : decimalStringToMinorUnits(String(policy.feeMax));

  // Half-up rounding on exact integer minor units. No floating point is used.
  const percentage = (principalCents * BigInt(policy.feeBps) + 5000n) / 10000n;
  let fee = 0n;
  if (policy.feeType === "FLAT" || policy.feeType === "FLAT_PLUS_PERCENTAGE") {
    fee += flat;
  }
  if (
    policy.feeType === "PERCENTAGE" ||
    policy.feeType === "FLAT_PLUS_PERCENTAGE"
  ) {
    fee += percentage;
  }

  if (fee < minimum) fee = minimum;
  if (maximum !== null && fee > maximum) fee = maximum;
  return fee;
};

const businessDateFor = (timezone, date = new Date()) => {
  assertTimezone(timezone);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const assertWithinDailyLimits = async ({
  tx,
  userId,
  type,
  policy,
  principalCents,
  feeCents = 0n,
  businessDate,
}) => {
  // Serializes concurrent transfers for the same customer and business day,
  // so two requests cannot both observe the same remaining limit. The function
  // returns void, so use $executeRaw rather than deserializing a column.
  await tx.$executeRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`${userId}:${type}:${businessDate}`}, 0)
    )
  `);

  const rows =
    type === "WITHDRAWAL"
      ? await tx.$queryRaw(Prisma.sql`
          SELECT COALESCE(SUM("amount"), 0)::text AS total,
                 COUNT(*)::int AS count
          FROM "Withdrawal"
          WHERE "userId" = ${userId}
            AND "businessDate" = ${businessDate}::date
            AND "status" = 'PENDING'
        `)
      : await tx.$queryRaw(Prisma.sql`
          SELECT COALESCE(SUM("amount" + "feeAmount"), 0)::text AS total,
                 COUNT(*)::int AS count
          FROM "Transaction"
          WHERE "initiatedByUserId" = ${userId}
            AND "type" = ${type}
            AND "businessDate" = ${businessDate}::date
            AND "status" IN ('POSTED', 'PARTIALLY_REVERSED')
        `);
  const currentTotal = decimalStringToMinorUnits(rows[0]?.total ?? "0");
  const currentCount = Number(rows[0]?.count ?? 0);
  const dailyAmount = decimalStringToMinorUnits(
    String(policy.dailyOutgoingAmount)
  );
  const nextTotal = currentTotal + principalCents + feeCents;

  if (nextTotal > dailyAmount) {
    throw ApiError.conflict(
      "Daily outgoing amount limit exceeded",
      "DAILY_LIMIT_EXCEEDED",
      {
        limit: fromMinorUnits(dailyAmount),
        used: fromMinorUnits(currentTotal),
        currency: policy.currency,
        businessDate,
      }
    );
  }
  if (currentCount + 1 > policy.dailyOutgoingCount) {
    throw ApiError.conflict(
      "Daily outgoing transaction count limit exceeded",
      "DAILY_COUNT_EXCEEDED",
      {
        limit: policy.dailyOutgoingCount,
        used: currentCount,
        businessDate,
      }
    );
  }

  return {
    businessDate,
    dailyLimit: fromMinorUnits(dailyAmount),
    dailyUsed: fromMinorUnits(currentTotal),
    dailyCountLimit: policy.dailyOutgoingCount,
    dailyCountUsed: currentCount,
  };
};

const policySnapshot = (policy, feeCents, decision = null) => ({
  policyId: policy.id,
  policyType: policy.type,
  currency: policy.currency,
  feeType: policy.feeType,
  feeAmount: fromMinorUnits(feeCents),
  feeBps: policy.feeBps,
  feeFlat: String(policy.feeFlat),
  timezone: policy.timezone,
  businessDate: decision?.businessDate ?? null,
  dailyLimit: decision?.dailyLimit ?? null,
  dailyUsed: decision?.dailyUsed ?? null,
  dailyCountLimit: decision?.dailyCountLimit ?? null,
  dailyCountUsed: decision?.dailyCountUsed ?? null,
});

const normalizeAmount = (value, field) => {
  try {
    return fromMinorUnits(toMinorUnits(String(value)));
  } catch {
    throw ApiError.validation({
      [field]: "Must be a positive decimal with at most two places",
    });
  }
};

const normalizePolicyInput = (input) => {
  const data = {};
  if (input.minAmount !== undefined) data.minAmount = normalizeAmount(input.minAmount, "minAmount");
  if (input.maxAmount !== undefined) data.maxAmount = normalizeAmount(input.maxAmount, "maxAmount");
  if (input.dailyOutgoingAmount !== undefined) {
    const value = String(input.dailyOutgoingAmount);
    const cents = decimalStringToMinorUnits(value);
    data.dailyOutgoingAmount = fromMinorUnits(cents);
  }
  if (input.dailyOutgoingCount !== undefined) {
    const count = Number(input.dailyOutgoingCount);
    if (!Number.isInteger(count) || count < 0 || count > 100000) {
      throw ApiError.validation({ dailyOutgoingCount: "Must be an integer from 0 to 100000" });
    }
    data.dailyOutgoingCount = count;
  }
  if (input.feeType !== undefined) {
    if (!FEE_TYPES.includes(input.feeType)) {
      throw ApiError.validation({ feeType: "Unsupported fee type" });
    }
    data.feeType = input.feeType;
  }
  if (input.feeFlat !== undefined) {
    data.feeFlat = fromMinorUnits(
      decimalStringToMinorUnits(String(input.feeFlat))
    );
  }
  if (input.feeMin !== undefined) {
    data.feeMin = fromMinorUnits(decimalStringToMinorUnits(String(input.feeMin)));
  }
  if (input.feeMax !== undefined) {
    data.feeMax =
      input.feeMax === null
        ? null
        : fromMinorUnits(decimalStringToMinorUnits(String(input.feeMax)));
  }
  if (input.feeBps !== undefined) {
    const bps = Number(input.feeBps);
    if (!Number.isInteger(bps) || bps < 0 || bps > 10000) {
      throw ApiError.validation({ feeBps: "Must be an integer from 0 to 10000" });
    }
    data.feeBps = bps;
  }
  if (input.timezone !== undefined) {
    assertTimezone(input.timezone);
    data.timezone = input.timezone;
  }
  return data;
};

const validatePolicyCombination = (policy) => {
  const min = decimalStringToMinorUnits(String(policy.minAmount));
  const max = decimalStringToMinorUnits(String(policy.maxAmount));
  if (min <= 0n || max < min) {
    throw ApiError.validation({ maxAmount: "Must be greater than or equal to minAmount" });
  }
  const feeMin = decimalStringToMinorUnits(String(policy.feeMin));
  if (policy.feeMax !== null && policy.feeMax !== undefined) {
    const feeMax = decimalStringToMinorUnits(String(policy.feeMax));
    if (feeMax < feeMin) {
      throw ApiError.validation({ feeMax: "Must be greater than or equal to feeMin" });
    }
  }
};

const listPolicies = async () =>
  prisma.financialPolicy.findMany({ orderBy: [{ type: "asc" }, { currency: "asc" }] });

const updatePolicy = async ({
  type,
  currency,
  input,
  actorUserId,
  reason,
}) => {
  if (!POLICY_TYPES.includes(type)) {
    throw ApiError.badRequest("Unknown policy type", "INVALID_POLICY_TYPE");
  }
  assertCurrency(currency);
  if (typeof reason !== "string" || reason.trim().length < 10) {
    throw ApiError.validation({
      reason: "A reason of at least 10 characters is required for policy changes",
    });
  }

  const data = normalizePolicyInput(input);
  if (Object.keys(data).length === 0) {
    throw ApiError.validation({ _policy: "No policy fields were supplied" });
  }

  const policy = await prisma.$transaction(
    async (tx) => {
      const current = await tx.financialPolicy.findUnique({
        where: { type_currency: { type, currency } },
      });
      if (!current) {
        throw ApiError.notFound("Financial policy not found", "POLICY_NOT_FOUND");
      }

      const merged = { ...current, ...data };
      validatePolicyCombination(merged);

      const updated = await tx.financialPolicy.update({
        where: { id: current.id },
        data,
      });
      await tx.financialPolicyRevision.create({
        data: {
          policyId: current.id,
          changedBy: actorUserId,
          reason: reason.trim(),
          snapshot: JSON.parse(JSON.stringify(updated)),
        },
      });
      return updated;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );

  audit("FINANCIAL_POLICY_UPDATED", {
    actorUserId,
    policyId: policy.id,
    type,
    currency,
    reason: reason.trim(),
  });
  return policy;
};

module.exports = {
  POLICY_TYPES,
  FEE_TYPES,
  getPolicy,
  assertAmountWithinPolicy,
  calculateFeeCents,
  businessDateFor,
  assertWithinDailyLimits,
  policySnapshot,
  listPolicies,
  updatePolicy,
};
