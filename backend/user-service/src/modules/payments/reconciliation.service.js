const env = require("../../config/env");
const prisma = require("../../config/database");
const logger = require("../../config/logger");
const audit = require("../../utils/audit");
const { getPaymentsService } = require("./payments.factory");

const SAFE_DETAIL_LIMIT = 300;

const safeDetails = (value) => {
  if (!value) return null;
  return String(value).slice(0, SAFE_DETAIL_LIMIT);
};

const classify = (result, error) => {
  if (!error) {
    if (result?.payment?.status === "COMPLETED") return "MATCHED";
    if (result?.payment?.status === "PENDING") return "PENDING";
    if (result?.payment?.status === "FAILED") return "MATCHED";
    return "MANUAL_REVIEW";
  }

  const code = error.code || "";
  if (code.includes("MISMATCH")) return "MISMATCH";
  if (code === "PAYMENT_NOT_FOUND" || code === "LEDGER_WALLET_MISMATCH") {
    return "MANUAL_REVIEW";
  }
  return "ERROR";
};

const reconcilePayment = async (payment, { trigger, actorUserId }) => {
  const service = getPaymentsService();
  const previousAttempts = await prisma.paymentReconciliationRecord.count({
    where: { paymentId: payment.id },
  });

  let result = null;
  let error = null;
  try {
    result = await service.processVerification(payment.reference);
  } catch (caught) {
    error = caught;
  }

  const verification = result?.verification || null;
  const outcome = classify(result, error);

  await prisma.paymentReconciliationRecord.create({
    data: {
      paymentId: payment.id,
      attempt: previousAttempts + 1,
      trigger,
      providerStatus: verification?.rawStatus ?? verification?.status ?? null,
      providerRef: verification?.providerRef ?? null,
      providerAmount: verification?.amount ?? null,
      providerCurrency: verification?.currency ?? null,
      outcome,
      details: safeDetails(error?.message || result?.payment?.failureReason),
    },
  });

  audit("PAYMENT_RECONCILIATION_ATTEMPT", {
    paymentReference: payment.reference,
    outcome,
    attempt: previousAttempts + 1,
    trigger,
    actorUserId,
  });

  return {
    paymentReference: payment.reference,
    outcome,
    paymentStatus: result?.payment?.status ?? null,
    errorCode: error?.code ?? null,
  };
};

const reconcilePendingPayments = async ({
  olderThanMinutes = env.RECONCILIATION_STALE_MINUTES,
  limit = env.RECONCILIATION_BATCH_SIZE,
  trigger = "SCHEDULED",
  actorUserId = null,
} = {}) => {
  if (!Number.isInteger(olderThanMinutes) || olderThanMinutes < 1) {
    throw new TypeError("olderThanMinutes must be a positive integer");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new TypeError("limit must be between 1 and 500");
  }

  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
  const pending = await prisma.payment.findMany({
    where: { status: "PENDING", createdAt: { lt: cutoff } },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, reference: true },
  });

  const results = [];
  for (const payment of pending) {
    try {
      results.push(await reconcilePayment(payment, { trigger, actorUserId }));
    } catch (error) {
      // A database failure while recording an attempt must not stop the rest
      // of the batch. The next run retries the still-pending payment.
      logger.error(
        { err: error, paymentReference: payment.reference },
        "Payment reconciliation attempt failed"
      );
      results.push({
        paymentReference: payment.reference,
        outcome: "ERROR",
        errorCode: error?.code || "RECONCILIATION_RECORD_FAILED",
      });
    }
  }

  return {
    checked: pending.length,
    cutoff: cutoff.toISOString(),
    results,
  };
};

let timer = null;
let running = false;

const startReconciliationJob = () => {
  if (!env.RECONCILIATION_ENABLED || timer) return null;
  if (!env.CHAPA_SECRET_KEY) {
    logger.warn(
      "RECONCILIATION_ENABLED is set but Chapa Test Mode is not configured; scheduler will not start"
    );
    return null;
  }

  timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const summary = await reconcilePendingPayments();
      if (summary.checked > 0) {
        logger.info(
          { checked: summary.checked, results: summary.results },
          "Scheduled payment reconciliation completed"
        );
      }
    } catch (error) {
      logger.error({ err: error }, "Scheduled payment reconciliation failed");
    } finally {
      running = false;
    }
  }, env.RECONCILIATION_INTERVAL_MS);
  timer.unref();
  logger.info(
    {
      intervalMs: env.RECONCILIATION_INTERVAL_MS,
      staleMinutes: env.RECONCILIATION_STALE_MINUTES,
      batchSize: env.RECONCILIATION_BATCH_SIZE,
    },
    "Payment reconciliation scheduler started"
  );
  return timer;
};

const stopReconciliationJob = () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
};

module.exports = {
  reconcilePendingPayments,
  startReconciliationJob,
  stopReconciliationJob,
};
