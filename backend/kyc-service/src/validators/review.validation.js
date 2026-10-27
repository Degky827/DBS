const { z } = require("zod");

const reviewDecisionSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  reason: z.string().trim().min(5).max(1000),
}).strict();

module.exports = { reviewDecisionSchema };
