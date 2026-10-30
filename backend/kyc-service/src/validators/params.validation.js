const { z } = require("zod");

const submissionParamsSchema = z.object({
  submissionId: z.string().uuid(),
});

const documentParamsSchema = z.object({
  documentId: z.string().uuid(),
});

const userParamsSchema = z.object({
  userId: z.string().uuid(),
});

module.exports = {
  submissionParamsSchema,
  documentParamsSchema,
  userParamsSchema,
};
