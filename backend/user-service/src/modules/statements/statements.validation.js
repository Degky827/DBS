const { z } = require("zod");

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const validDate = (value) => {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
};

const dateField = z.string().refine(validDate, { message: "Expected a valid YYYY-MM-DD date" });

const statementQuerySchema = z.object({
  from: dateField.optional(),
  to: dateField.optional(),
});

module.exports = { statementQuerySchema, validDate };
