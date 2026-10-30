const { z } = require("zod");
const { decimalStringToMinorUnits } = require("../wallets/money");

const amount = (field) =>
  z.string().refine((value) => {
    try {
      return decimalStringToMinorUnits(value) >= 0n;
    } catch {
      return false;
    }
  }, `${field} must be a non-negative decimal with at most two places`);

const policyUpdateSchema = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    minAmount: amount("minAmount").optional(),
    maxAmount: amount("maxAmount").optional(),
    dailyOutgoingAmount: amount("dailyOutgoingAmount").optional(),
    dailyOutgoingCount: z.number().int().min(0).max(100000).optional(),
    feeType: z
      .enum(["NONE", "FLAT", "PERCENTAGE", "FLAT_PLUS_PERCENTAGE"])
      .optional(),
    feeFlat: amount("feeFlat").optional(),
    feeMin: amount("feeMin").optional(),
    feeMax: amount("feeMax").nullable().optional(),
    feeBps: z.number().int().min(0).max(10000).optional(),
    timezone: z.string().min(1).max(64).optional(),
    reason: z.string().min(10).max(500),
  })
  .strict();

const reconciliationSchema = z
  .object({
    olderThanMinutes: z.number().int().min(1).max(10080).optional(),
    limit: z.number().int().min(1).max(500).optional(),
  })
  .strict();

module.exports = { policyUpdateSchema, reconciliationSchema };
