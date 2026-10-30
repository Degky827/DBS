const { z } = require("zod");
const { SUBMISSION_STATUS } = require("../constants/kycStatus");

const reviewDecisionSchema = z
  .object({
    decision: z.enum(["APPROVE", "REJECT"]),
    reason: z.string().trim().min(5).max(1000),
  })
  .strict();

const reviewQueueSchema = z
  .object({
    status: z
      .enum([...Object.values(SUBMISSION_STATUS), "ALL"])
      .default(SUBMISSION_STATUS.PENDING_REVIEW),
    q: z.string().trim().min(3).max(120).optional(),
    sort: z.enum(["oldest", "newest"]).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.uuid().optional(),
  })
  .strict()
  .refine(
    ({ from, to }) => !from || !to || new Date(from) <= new Date(to),
    { path: ["to"], message: "to must be later than or equal to from" }
  );

module.exports = { reviewDecisionSchema, reviewQueueSchema };
