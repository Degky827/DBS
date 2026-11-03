const { z } = require("zod");

const reasonEnum = z.enum([
  "UNAUTHORIZED",
  "DUPLICATE_CHARGE",
  "NOT_RECEIVED",
  "INCORRECT_AMOUNT",
  "SERVICE_NOT_RECEIVED",
  "OTHER",
]);

const createDisputeSchema = z
  .object({
    transactionReference: z.uuid(),
    reason: reasonEnum,
    description: z
      .string()
      .trim()
      .min(20, "Describe the issue in at least 20 characters")
      .max(2000, "Description must be at most 2000 characters"),
  })
  .strict();

const updateDisputeSchema = z
  .object({
    status: z.enum(["UNDER_REVIEW", "RESOLVED", "REJECTED"]),
    resolution: z.string().trim().max(2000).optional(),
    assignedTo: z.string().trim().max(120).optional(),
    resolvedAmount: z
      .string()
      .regex(/^\d{1,17}(\.\d{1,2})?$/, "Amount must be a positive decimal with at most two places")
      .optional(),
  })
  .strict();

const listQuerySchema = z
  .object({
    status: z.enum(["OPEN", "UNDER_REVIEW", "RESOLVED", "REJECTED"]).optional(),
    q: z.string().trim().min(3).max(100).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.uuid().optional(),
  })
  .strict();

module.exports = { createDisputeSchema, updateDisputeSchema, listQuerySchema };
