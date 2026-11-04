const { z } = require("zod");

const createScheduleSchema = z
  .object({
    destinationWalletId: z.uuid(),
    amount: z
      .string()
      .regex(/^\d{1,17}(\.\d{1,2})?$/, "Amount must be a positive decimal with at most two places"),
    frequency: z.enum(["ONCE", "DAILY", "WEEKLY", "MONTHLY"]),
    firstRunAt: z.iso.datetime({ offset: true }),
    timezone: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

const listSchedulesSchema = z
  .object({
    status: z.enum(["ACTIVE", "PAUSED", "COMPLETED", "CANCELLED", "FAILED"]).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.uuid().optional(),
  })
  .strict();

module.exports = { createScheduleSchema, listSchedulesSchema };
