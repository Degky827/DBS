const { z } = require("zod");

const emptyToUndefined = (value) =>
  value === "" || value === undefined || value === null ? undefined : value;

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().uuid().optional(),
  unreadOnly: z
    .preprocess(emptyToUndefined, z.enum(["true", "false"]).optional())
    .transform((value) => value === "true"),
  eventType: z.string().trim().min(1).max(120).optional(),
});

const eventSchema = z.object({
  eventId: z.string().uuid(),
  type: z.string().trim().min(1).max(120),
  aggregateType: z.string().trim().max(120).optional(),
  aggregateId: z.string().trim().max(200).optional(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

const notificationIdSchema = z.object({
  notificationId: z.string().uuid(),
});

module.exports = { listQuerySchema, eventSchema, notificationIdSchema };
