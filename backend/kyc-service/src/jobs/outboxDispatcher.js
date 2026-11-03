const prisma = require("../config/database");
const env = require("../config/env");
const logger = require("../config/logger");
const metrics = require("../utils/metrics");

const REQUEST_TIMEOUT_MS = 5000;
const BASE_BACKOFF_MS = 5000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;

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

  // 409 means notification-service already recorded this eventId, so the
  // customer has been asked once. Treating it as success keeps a lost
  // acknowledgement from producing a second reminder.
  if (response.ok || response.status === 409) return;

  const detail = await response.text().catch(() => "");
  throw new Error(`notification-service responded ${response.status}: ${detail.slice(0, 200)}`);
};

const processBatch = async () => {
  if (running) return;
  running = true;

  try {
    const due = await prisma.kycOutboxEvent.findMany({
      where: {
        publishedAt: null,
        nextAttemptAt: { lte: new Date() },
        attempts: { lt: env.OUTBOX_MAX_ATTEMPTS },
      },
      orderBy: { nextAttemptAt: "asc" },
      take: env.OUTBOX_BATCH_SIZE,
    });

    for (const event of due) {
      try {
        await deliver(event);
        await prisma.kycOutboxEvent.update({
          where: { id: event.id },
          data: { publishedAt: new Date(), lastError: null },
        });
        metrics.recordOutboxEvent("published");
      } catch (error) {
        const attempts = event.attempts + 1;
        await prisma.kycOutboxEvent.update({
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
          {
            eventId: event.eventId,
            type: event.type,
            attempts,
            error: error.message,
          },
          "KYC outbox delivery failed"
        );
      }
    }

    metrics.setOutboxPending(await prisma.kycOutboxEvent.count({ where: { publishedAt: null } }));
  } catch (error) {
    logger.error({ error: error.message }, "KYC outbox dispatcher cycle failed");
  } finally {
    running = false;
  }
};

const startOutboxDispatcher = () => {
  if (!env.OUTBOX_ENABLED) {
    logger.info("KYC outbox dispatcher disabled");
    return;
  }
  if (!env.NOTIFICATION_SERVICE_URL) {
    logger.warn("KYC outbox dispatcher enabled without NOTIFICATION_SERVICE_URL");
    return;
  }

  timer = setInterval(processBatch, env.OUTBOX_INTERVAL_MS);
  timer.unref();
  processBatch();
  logger.info(
    {
      intervalMs: env.OUTBOX_INTERVAL_MS,
      batchSize: env.OUTBOX_BATCH_SIZE,
    },
    "KYC outbox dispatcher started"
  );
};

const stopOutboxDispatcher = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

module.exports = { startOutboxDispatcher, stopOutboxDispatcher, processBatch };
