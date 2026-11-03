const prisma = require("../config/database");
const env = require("../config/env");

const isEnabled = () => env.OUTBOX_ENABLED;

// Callers pass an explicit eventId when re-delivering would duplicate a
// customer-visible message (a re-verification reminder for a given task). The
// unique constraint then makes the second insert a no-op instead of a second
// notification, so a job that runs on every cycle stays safe.
const enqueue = async (
  tx,
  { type, aggregateType, aggregateId, payload, occurredAt = new Date(), eventId }
) => {
  if (!type || !aggregateType || !aggregateId) {
    throw new Error("Outbox events require type, aggregateType and aggregateId");
  }
  if (!isEnabled()) return null;

  try {
    return await tx.kycOutboxEvent.create({
      data: {
        eventId,
        type,
        aggregateType,
        aggregateId,
        payload,
        occurredAt,
      },
      select: { id: true, eventId: true },
    });
  } catch (error) {
    if (error && error.code === "P2002") return null;
    throw error;
  }
};

const countPending = async () => prisma.kycOutboxEvent.count({ where: { publishedAt: null } });

module.exports = { enqueue, countPending, isEnabled };
