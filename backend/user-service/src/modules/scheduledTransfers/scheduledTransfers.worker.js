const env = require("../../config/env");
const logger = require("../../config/logger");
const { executeDueSchedules } = require("./scheduledTransfers.service");

let timer = null;
let running = false;

const tick = async () => {
  if (running) return;
  running = true;
  try {
    const { processed } = await executeDueSchedules();
    if (processed > 0) {
      logger.info({ processed }, "Executed due scheduled transfers");
    }
  } catch (error) {
    logger.error({ error: error.message }, "Scheduled transfer worker cycle failed");
  } finally {
    running = false;
  }
};

const startScheduledTransferWorker = () => {
  if (!env.SCHEDULED_TRANSFERS_ENABLED) {
    logger.info("Scheduled transfer worker disabled");
    return;
  }
  timer = setInterval(tick, env.SCHEDULED_TRANSFERS_INTERVAL_MS);
  timer.unref();
  tick();
  logger.info(
    { intervalMs: env.SCHEDULED_TRANSFERS_INTERVAL_MS },
    "Scheduled transfer worker started"
  );
};

const stopScheduledTransferWorker = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

module.exports = { startScheduledTransferWorker, stopScheduledTransferWorker };
