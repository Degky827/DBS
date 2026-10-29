const { z } = require("zod");
const { isValidAmount } = require("./money");

const amountSchema = z
  .string()
  .refine(
    isValidAmount,
    "Amount must be a positive decimal with at most two places"
  );

const transferSchema = z
  .object({
    destinationWalletId: z.uuid(),
    amount: amountSchema,
  })
  .strict();

const reversalSchema = z
  .object({
    amount: amountSchema.optional(),
    reason: z
      .string()
      .trim()
      .min(5, "Reason must be at least 5 characters")
      .max(500, "Reason must be at most 500 characters"),
  })
  .strict();

const transactionHistorySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.uuid().optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    direction: z.enum(["all", "incoming", "outgoing"]).default("all"),
    type: z.enum(["TRANSFER", "DEPOSIT"]).optional(),
    status: z.enum(["POSTED", "PARTIALLY_REVERSED", "REVERSED"]).optional(),
    q: z.string().trim().min(3).max(100).optional(),
  })
  .strict()
  .refine(
    ({ from, to }) => !from || !to || new Date(from) <= new Date(to),
    { path: ["to"], message: "to must be later than or equal to from" }
  );

module.exports = { transferSchema, reversalSchema, transactionHistorySchema };