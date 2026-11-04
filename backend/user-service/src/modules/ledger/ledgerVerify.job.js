const env = require("../../config/env");
const logger = require("../../config/logger");
const { runVerification, lastRunTimestamp } = require("./ledgerVerify.service");

// Scheduled ledger verification. Mirrors the outbox dispatcher and the
// reconciliation scheduler: one unref'd timer, a single-flight guard so a slow
// cycle can never overlap the next one, and no crash can take the service down.

let timer = null;
let running = false;

const runCycle = async () => {
  if (running) return null;
  running = true;
  try {
    return await runVerification({ trigger: "SCHEDULED" });
  } catch (error) {
    logger.error({ err: error }, "Scheduled ledger verification failed");
    return null;
  } finally {
    running = false;
  }
};

const startLedgerVerificationJob = () => {
  if (timer) return timer;
  if (!env.ENABLE_JOBS || !env.LEDGER_VERIFICATION_ENABLED) {
    logger.info("Ledger verification job disabled");
    return null;
  }

  timer = setInterval(runCycle, env.LEDGER_VERIFICATION_INTERVAL_MS);
  timer.unref();

  // Prometheus needs a value before the first cycle so "job stalled" can fire
  // on a service that has just restarted, using the last run already in history.
  lastRunTimestamp().catch((error) =>
    logger.warn({ err: error }, "Ledger verification history could not be read")
  );

  logger.info(
    { intervalMs: env.LEDGER_VERIFICATION_INTERVAL_MS },
    "Ledger verification job started"
  );
  return timer;
};

const stopLedgerVerificationJob = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

module.exports = {
  startLedgerVerificationJob,
  stopLedgerVerificationJob,
  runCycle,
  isRunning: () => running,
};
