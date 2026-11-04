const { z } = require("zod");
const { documentTypeSchema } = require("./document.validation");
const { ASSIGNMENT_STATUS, REASON, TIER_OPERATIONS } = require("../constants/kycTier");

// Tier codes are ordered by their numeric suffix, and the database only accepts
// this shape, so the API refuses anything else instead of creating a tier no
// ranking rule can place.
const tierCodeSchema = z
  .string()
  .trim()
  .regex(/^TIER_[0-9]+$/, "Tier code must look like TIER_2")
  .max(40);

// Tier ids are opaque row ids. The seeded policy rows use readable slugs
// ("tier-def-sample-tier-1"), so requiring a UUID here would reject a tier the
// database just handed out.
const tierIdSchema = z.string().trim().min(1).max(64);

const tierIdParamsSchema = z.object({ tierId: tierIdSchema });
const assignmentParamsSchema = z.object({ assignmentId: z.string().uuid() });

// Money is a decimal string end to end. Accepting a JSON number here would put
// a float in front of a DECIMAL(19,2) column.
const decimalAmountSchema = z
  .string()
  .trim()
  .regex(
    /^(0|[1-9][0-9]{0,16})(\.[0-9]{1,2})?$/,
    "Amount must be a decimal string with at most two fractional digits"
  )
  .max(20);

const optionalAmountSchema = decimalAmountSchema.nullable().optional();
const optionalCountSchema = z.number().int().min(1).max(100000).nullable().optional();

const tierLimitSchema = z
  .object({
    operation: z.enum(TIER_OPERATIONS),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter uppercase code")
      .default("ETB"),
    minAmount: decimalAmountSchema.default("0"),
    maxAmount: optionalAmountSchema,
    dailyAmount: optionalAmountSchema,
    dailyCount: optionalCountSchema,
    monthlyAmount: optionalAmountSchema,
    maxBalance: optionalAmountSchema,
    isAllowed: z.boolean().default(true),
  })
  .strict()
  .refine(({ minAmount, maxAmount }) => !maxAmount || Number(maxAmount) >= Number(minAmount), {
    path: ["maxAmount"],
    message: "maxAmount must be at least minAmount",
  });

const createTierSchema = z
  .object({
    code: tierCodeSchema,
    name: z.string().trim().min(3).max(120),
    description: z.string().trim().max(500).optional(),
    minimumDocuments: z.number().int().min(1).max(20),
    requiresLiveness: z.boolean().default(false),
    requiredFields: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
    requiredDocumentTypes: z.array(documentTypeSchema).max(10).default([]),
    allowedOperations: z.array(z.enum(TIER_OPERATIONS)).max(5).default([]),
    reviewIntervalDays: z.number().int().min(1).max(3650).nullable().optional(),
    approvalValidDays: z.number().int().min(1).max(3650).nullable().optional(),
    reVerificationLeadDays: z.number().int().min(1).max(365).default(30),
    limits: z.array(tierLimitSchema).max(5).optional(),
  })
  .strict();

const updateTierLimitsSchema = z
  .object({
    limits: z.array(tierLimitSchema).min(1).max(TIER_OPERATIONS.length),
  })
  .strict()
  .refine(
    ({ limits }) =>
      new Set(limits.map((row) => `${row.operation}:${row.currency}`)).size === limits.length,
    { path: ["limits"], message: "One limit row per operation and currency" }
  );

const tierRequestSchema = z
  .object({
    tierCode: tierCodeSchema,
    reason: z.string().trim().min(5).max(500),
  })
  .strict();

const tierDecisionSchema = z
  .object({
    decision: z.enum(["APPROVE", "REJECT"]),
    decisionReason: z.string().trim().min(5).max(1000),
  })
  .strict();

const tierRequestQueueSchema = z
  .object({
    status: z.enum(Object.values(ASSIGNMENT_STATUS)).default(ASSIGNMENT_STATUS.REQUESTED),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

const tierAssignmentHistorySchema = z
  .object({
    userId: z.string().uuid(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

const reVerificationTaskParamsSchema = z.object({
  taskId: z.string().uuid(),
});

const reVerificationWaiverSchema = z
  .object({
    reason: z.string().trim().min(5).max(1000),
  })
  .strict();

const reVerificationCreateSchema = z
  .object({
    userId: z.string().uuid(),
    reason: z.enum([
      REASON.PERIODIC_REVIEW,
      REASON.TIER_UPGRADE,
      REASON.SCREENING_FOLLOW_UP,
      REASON.MANUAL,
    ]),
    dueInDays: z.number().int().min(1).max(365).default(30),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

const reVerificationQueueSchema = z
  .object({
    status: z.enum(["OPEN", "ALL", ...Object.values(REASON)]).optional(),
    reason: z.enum(Object.values(REASON)).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().uuid().optional(),
  })
  .strict();

module.exports = {
  tierIdSchema,
  tierCodeSchema,
  tierIdParamsSchema,
  assignmentParamsSchema,
  tierLimitSchema,
  createTierSchema,
  updateTierLimitsSchema,
  tierRequestSchema,
  tierDecisionSchema,
  tierRequestQueueSchema,
  tierAssignmentHistorySchema,
  reVerificationTaskParamsSchema,
  reVerificationWaiverSchema,
  reVerificationCreateSchema,
  reVerificationQueueSchema,
};
