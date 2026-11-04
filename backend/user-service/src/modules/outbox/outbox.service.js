const prisma = require("../../config/database");
const env = require("../../config/env");
const ApiError = require("../../utils/ApiError");

const isEnabled = () => env.OUTBOX_ENABLED;

// Must be called with the same transaction handle that performs the business
// change: either the event and the change commit together, or neither does.
const enqueue = async (
  tx,
  { type, aggregateType, aggregateId, payload, occurredAt = new Date() }
) => {
  if (!type || !aggregateType || !aggregateId) {
    throw new Error("Outbox events require type, aggregateType and aggregateId");
  }
  if (!isEnabled()) return null;

  return tx.outboxEvent.create({
    data: {
      type,
      aggregateType,
      aggregateId,
      payload,
      occurredAt,
    },
    select: { id: true, eventId: true },
  });
};

const listEvents = async ({ status = "pending", limit = 50, cursor } = {}) => {
  const where = {};
  if (status === "pending") {
    where.publishedAt = null;
  } else if (status === "published") {
    where.publishedAt = { not: null };
  } else if (status === "failed") {
    where.publishedAt = null;
    where.attempts = { gt: 0 };
  } else if (status !== "all") {
    throw ApiError.badRequest("Unsupported outbox status filter", "INVALID_OUTBOX_STATUS");
  }

  if (cursor) {
    const existing = await prisma.outboxEvent.findUnique({
      where: { id: cursor },
      select: { id: true },
    });
    if (!existing) {
      throw ApiError.badRequest("Outbox cursor is invalid", "INVALID_OUTBOX_CURSOR");
    }
  }

  const events = await prisma.outboxEvent.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: limit + 1,
    select: {
      id: true,
      eventId: true,
      type: true,
      aggregateType: true,
      aggregateId: true,
      payload: true,
      occurredAt: true,
      publishedAt: true,
      attempts: true,
      nextAttemptAt: true,
      lastError: true,
      createdAt: true,
    },
  });
  const hasMore = events.length > limit;
  const page = events.slice(0, limit);

  return {
    events: page.map((event) => ({
      ...event,
      status: event.publishedAt ? "PUBLISHED" : event.attempts > 0 ? "RETRYING" : "PENDING",
    })),
    page: {
      limit,
      hasMore,
      nextCursor: hasMore ? page[page.length - 1].id : null,
    },
  };
};

// Operators can replay a dead-lettered event without changing its eventId, so
// downstream consumers still deduplicate it if it was already applied.
const replay = async (eventId) => {
  const updated = await prisma.outboxEvent.updateMany({
    where: { eventId, publishedAt: null },
    data: { attempts: 0, nextAttemptAt: new Date(), lastError: null },
  });
  if (updated.count === 0) {
    const event = await prisma.outboxEvent.findUnique({
      where: { eventId },
      select: { publishedAt: true },
    });
    if (!event) {
      throw ApiError.notFound("Outbox event not found", "OUTBOX_EVENT_NOT_FOUND");
    }
    throw ApiError.conflict(
      "Published outbox events cannot be replayed",
      "OUTBOX_EVENT_ALREADY_PUBLISHED"
    );
  }
  const event = await prisma.outboxEvent.findUnique({ where: { eventId } });
  return event;
};

module.exports = { enqueue, listEvents, replay, isEnabled };
