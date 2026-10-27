const pino = require("pino");
const env = require("./env");

const logger = pino({
  level: env.LOG_LEVEL,
  base: {
    service: "kyc-service",
    env: env.NODE_ENV,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "password",
      "token",
      "refreshToken",
      "documentText",
      "ocrText",
      "extractedData",
      "nationalId",
      "filePath",
      "sessionToken",
      "session_url",
    ],
    censor: "[REDACTED]",
  },
});

module.exports = logger;
