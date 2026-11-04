const prisma = require("../config/database");
const env = require("../config/env");
const logger = require("../config/logger");
const metrics = require("../utils/metrics");
const { sendNotificationEmail } = require("./email.service");

const BASE_BACKOFF_MS = 30 * 1000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;
const BATCH_SIZE = 20;

let timer = null;
let running = false;

const backoffFor = (attempts) =>
  Math.min(BASE_BACKOFF_MS * 2 ** Math.min(attempts, 8), MAX_BACKOFF_MS);

const deliverOne = async (notification) => {
  const attempts = notification.emailAttempts + 1;
  try {
    await sendNotificationEmail(notification);
    await prisma.notification.update({
      where: { id: notification.id },
      data: {
        emailStatus: "SENT",
        emailAttempts: attempts,
        emailSentAt: new Date(),
        emailError: null,
      },
    });
  } catch (error) {
    const exhausted = attempts >= env.EMAIL_MAX_ATTEMPTS;
    const terminal = exhausted || error.retryable === false;
    await prisma.notification.update({
      where: { id: notification.id },
      data: {
        emailStatus: terminal ? "FAILED" : "PENDING",
        emailAttempts: attempts,
        emailNextAttemptAt: new Date(Date.now() + backoffFor(attempts)),
        emailError: String(error.message || error).slice(0, 500),
      },
    });
    metrics.recordEmail(terminal ? "exhausted" : "retry");
    logger.warn(
      { notificationId: notification.id, attempts, terminal, error: error.message },
      "Notification email delivery failed"
    );
  }
};

const processEmailQueue = async ({ limit = BATCH_SIZE } = {}) => {
  if (running || !env.EMAIL_ENABLED) return { processed: 0 };

  running = true;
  try {
    const due = await prisma.notification.findMany({
      where: {
        emailStatus: "PENDING",
        emailNextAttemptAt: { lte: new Date() },
      },
      orderBy: { emailNextAttemptAt: "asc" },
      take: limit,
    });

    for (const notification of due) {
      await deliverOne(notification);
    }

    const backlog = await prisma.notification.count({
      where: { emailStatus: "PENDING" },
    });
    metrics.setEmailBacklog(backlog);
    return { processed: due.length };
  } catch (error) {
    logger.error({ error: error.message }, "Notification email worker cycle failed");
    return { processed: 0 };
  } finally {
    running = false;
  }
};

const startEmailWorker = () => {
  if (!env.EMAIL_ENABLED) {
    logger.info("Notification email worker disabled");
    return;
  }
  timer = setInterval(processEmailQueue, env.EMAIL_RETRY_INTERVAL_MS);
  timer.unref();
  processEmailQueue();
  logger.info(
    { intervalMs: env.EMAIL_RETRY_INTERVAL_MS, maxAttempts: env.EMAIL_MAX_ATTEMPTS },
    "Notification email worker started"
  );
};

const stopEmailWorker = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

module.exports = { startEmailWorker, stopEmailWorker, processEmailQueue };
