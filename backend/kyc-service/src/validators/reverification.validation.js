const { z } = require("zod");
const { TASK_STATUS, REASON } = require("../constants/kycTier");

const emptyToUndefined = (value) =>
  value === "" || value === undefined || value === null ? undefined : value;

const taskIdParamsSchema = z.object({ taskId: z.string().uuid() });

const statusSchema = z.enum(Object.values(TASK_STATUS));
const reasonSchema = z.enum(Object.values(REASON));
const limitSchema = z.coerce.number().int().min(1).max(100).optional();

const myTaskQuerySchema = z
  .object({
    status: statusSchema.optional(),
    limit: limitSchema,
  })
  .strict();

const officerTaskQueueSchema = z
  .object({
    status: statusSchema.optional(),
    reason: reasonSchema.optional(),
    overdueOnly: z
      .preprocess(emptyToUndefined, z.enum(["true", "false"]).optional())
      .transform((value) => value === "true"),
    limit: limitSchema,
  })
  .strict();

const waiveTaskSchema = z
  .object({
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

module.exports = {
  taskIdParamsSchema,
  myTaskQuerySchema,
  officerTaskQueueSchema,
  waiveTaskSchema,
};
