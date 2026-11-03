const env = require("../config/env");
const logger = require("../config/logger");
const { sweep } = require("../services/reVerificationService");

let timer = null;
let running = false;

const runOnce = async () => {
  if (running) return;
  running = true;
  try {
    await sweep();
  } catch (error) {
    // sweep() records the failure metric itself; the scheduler must survive a
    // bad cycle so the next one still runs.
    logger.error({ error: error.message }, "KYC re-verification cycle failed");
  } finally {
    running = false;
  }
};

const startReVerificationSweeper = () => {
  if (!env.KYC_REVERIFICATION_ENABLED) {
    logger.info("KYC re-verification sweeper disabled");
    return;
  }

  timer = setInterval(runOnce, env.KYC_REVERIFICATION_INTERVAL_MS);
  timer.unref();
  runOnce();
  logger.info(
    {
      intervalMs: env.KYC_REVERIFICATION_INTERVAL_MS,
      batchSize: env.KYC_REVERIFICATION_BATCH_SIZE,
    },
    "KYC re-verification sweeper started"
  );
};

const stopReVerificationSweeper = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

module.exports = { startReVerificationSweeper, stopReVerificationSweeper, runOnce };
