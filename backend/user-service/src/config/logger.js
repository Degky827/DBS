const pino = require("pino");
const env = require("./env");

const logger = pino({
  level: env.LOG_LEVEL,
  base: {
    service: "user-service",
    env: env.NODE_ENV,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers['x-dev-api-key']",
      "password",
      "currentPassword",
      "newPassword",
      "passwordHash",
      "token",
      "refreshToken",
    ],
    censor: "[REDACTED]",
  },
});

module.exports = logger;
