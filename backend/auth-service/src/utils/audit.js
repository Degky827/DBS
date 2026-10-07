const logger = require("../config/logger");

const audit = (event, details = {}) => {
  logger.info({ audit: true, event, ...details }, `audit: ${event}`);
};

module.exports = audit;
