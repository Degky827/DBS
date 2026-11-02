const logger = require("../config/logger");
const metrics = require("./metrics");

const audit = (event, details = {}) => {
  metrics.recordSecurityEvent(event);
  logger.info({ audit: true, event, ...details }, `audit: ${event}`);
};

module.exports = audit;
