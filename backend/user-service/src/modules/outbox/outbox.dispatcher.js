const prisma = require("../../config/database");
const env = require("../../config/env");
const logger = require("../../config/logger");
const metrics = require("../../utils/metrics");

const REQUEST_TIMEOUT_MS = 5000;
const BASE_BACKOFF_MS = 5000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;
// How long a claimed row stays off the table while this instance works on it.
const LEASE_SECONDS = 60;

// Replica safety: FOR UPDATE SKIP LOCKED makes a second dispatcher take other
// rows instead of the same ones, and pushing nextAttemptAt forward leases the
// claim. A worker that dies mid-delivery simply loses the lease and the row is
// retried; notification-service dedupes by eventId, so a retry is not a second
// notification.
const claimDue = () =>
  prisma.$queryRaw`
    WITH picked AS (
      SELECT "id"
      FROM "OutboxEvent"
      WHERE "publishedAt" IS NULL
        AND "nextAttemptAt" <= now()
        AND "attempts" < ${env.OUTBOX_MAX_ATTEMPTS}
      ORDER BY "nextAttemptAt"
      LIMIT ${env.OUTBOX_BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "OutboxEvent" AS o
    SET "nextAttemptAt" = now() + make_interval(secs => ${LEASE_SECONDS}::int)
    FROM picked
    WHERE o."id" = picked."id"
    RETURNING o.*`;

let timer = null;
let running = false;

const backoffFor = (attempts) =>
  Math.min(BASE_BACKOFF_MS * 2 ** Math.min(attempts, 10), MAX_BACKOFF_MS);

const endpoint = () =>
  `${env.NOTIFICATION_SERVICE_URL.replace(/\/+$/, "")}/internal/notifications/events`;

const deliver = async (event) => {
  const response = await fetch(endpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Service-Key": env.INTERNAL_SERVICE_KEY || "",
    },
    body: JSON.stringify({
      eventId: event.eventId,
      type: event.type,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      payload: event.payload,
      occurredAt: event.occurredAt.toISOString(),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  // 409 means the consumer already recorded this eventId; treating it as
  // success keeps redelivery idempotent after a lost acknowledgement.
  if (response.ok || response.status === 409) return;

  const detail = await response.text().catch(() => "");
  throw new Error(`notification-service responded ${response.status}: ${detail.slice(0, 200)}`);
};

const processBatch = async () => {
  if (running) return;
  running = true;

  try {
    const due = await claimDue();

    for (const event of due) {
      try {
        await deliver(event);
        await prisma.outboxEvent.update({
          where: { id: event.id },
          data: { publishedAt: new Date(), lastError: null },
        });
        metrics.recordOutboxEvent("published");
      } catch (error) {
        const attempts = event.attempts + 1;
        await prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            attempts,
            nextAttemptAt: new Date(Date.now() + backoffFor(attempts)),
            lastError: String(error.message || error).slice(0, 500),
          },
        });
        metrics.recordOutboxEvent(
          attempts >= env.OUTBOX_MAX_ATTEMPTS ? "dead_lettered" : "retrying"
        );
        logger.warn(
          { eventId: event.eventId, type: event.type, attempts, error: error.message },
          "Outbox delivery failed"
        );
      }
    }

    const pending = await prisma.outboxEvent.count({
      where: { publishedAt: null },
    });
    metrics.setOutboxPending(pending);
  } catch (error) {
    logger.error({ error: error.message }, "Outbox dispatcher cycle failed");
  } finally {
    running = false;
  }
};

const startOutboxDispatcher = () => {
  if (!env.ENABLE_JOBS || !env.OUTBOX_ENABLED) {
    logger.info("Outbox dispatcher disabled");
    return;
  }
  if (!env.NOTIFICATION_SERVICE_URL) {
    logger.warn("Outbox dispatcher enabled without NOTIFICATION_SERVICE_URL");
    return;
  }

  timer = setInterval(processBatch, env.OUTBOX_INTERVAL_MS);
  timer.unref();
  processBatch();
  logger.info(
    { intervalMs: env.OUTBOX_INTERVAL_MS, batchSize: env.OUTBOX_BATCH_SIZE },
    "Outbox dispatcher started"
  );
};

const stopOutboxDispatcher = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

module.exports = {
  startOutboxDispatcher,
  stopOutboxDispatcher,
  processBatch,
};
