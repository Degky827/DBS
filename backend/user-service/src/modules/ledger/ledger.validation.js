const { z } = require("zod");

const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const ISSUE_STATUSES = ["OPEN", "ACKNOWLEDGED", "RESOLVED", "SUPPRESSED"];
const RUN_STATUSES = ["RUNNING", "PASSED", "FAILED", "ERROR"];
const TRIGGERS = ["SCHEDULED", "MANUAL", "CI"];

const classification = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{2,59}$/, "Classification is not a known check code");

const listRunsSchema = z
  .object({
    status: z.enum(RUN_STATUSES).optional(),
    trigger: z.enum(TRIGGERS).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.uuid().optional(),
  })
  .strict();

const listIssuesSchema = z
  .object({
    status: z.enum([...ISSUE_STATUSES, "all"]).default("OPEN"),
    severity: z.enum(SEVERITIES).optional(),
    classification: classification.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.uuid().optional(),
  })
  .strict();

// businessDate is the accounting day the run is attributed to; the checks
// themselves always cover the whole book, so this is reporting metadata.
const startRunSchema = z
  .object({
    businessDate: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

const issueActionSchema = z
  .object({
    note: z
      .string()
      .trim()
      .min(5, "Explain what was done or why this is being ignored")
      .max(2000, "Note must be at most 2000 characters")
      .optional(),
  })
  .strict();

module.exports = {
  listRunsSchema,
  listIssuesSchema,
  startRunSchema,
  issueActionSchema,
};
