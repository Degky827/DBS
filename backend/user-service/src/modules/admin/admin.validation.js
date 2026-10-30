const { z } = require("zod");

const periodSchema = z
  .object({
    days: z.coerce.number().int().min(1).max(365).default(30),
  })
  .strict();

const userListSchema = z
  .object({
    q: z.string().trim().min(1).max(120).optional(),
    role: z
      .enum(["USER", "ADMIN", "OFFICER", "VERIFICATION_OFFICER", "FINANCIAL_OFFICER"])
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.uuid().optional(),
  })
  .strict();

const userIdParamsSchema = z.object({ userId: z.uuid() }).strict();

const referenceParamsSchema = z
  .object({ reference: z.string().trim().min(1).max(128) })
  .strict();

const dateRangeRefine = (value) =>
  !value.from || !value.to || new Date(value.from) <= new Date(value.to);

const platformTransactionSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.uuid().optional(),
    q: z.string().trim().min(3).max(100).optional(),
    type: z.enum(["TRANSFER", "DEPOSIT", "WITHDRAWAL"]).optional(),
    status: z.enum(["POSTED", "PARTIALLY_REVERSED", "REVERSED"]).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
  })
  .strict()
  .refine(dateRangeRefine, {
    path: ["to"],
    message: "to must be later than or equal to from",
  });

const platformPaymentSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.uuid().optional(),
    status: z.enum(["PENDING", "COMPLETED", "FAILED"]).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
  })
  .strict()
  .refine(dateRangeRefine, {
    path: ["to"],
    message: "to must be later than or equal to from",
  });

const auditLogSchema = z
  .object({
    source: z
      .enum([
        "FINANCIAL_POLICY",
        "TRANSACTION_REVERSAL",
        "PAYMENT_RECONCILIATION",
      ])
      .optional(),
    actorId: z.string().trim().min(1).max(120).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()
  .refine(dateRangeRefine, {
    path: ["to"],
    message: "to must be later than or equal to from",
  });

module.exports = {
  periodSchema,
  userListSchema,
  userIdParamsSchema,
  referenceParamsSchema,
  platformTransactionSchema,
  platformPaymentSchema,
  auditLogSchema,
};
