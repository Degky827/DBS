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
      'req.headers["set-cookie"]',
      'req.headers["x-internal-service-key"]',
      'req.headers["x-didit-signature"]',
      "res.headers.cookie",
      "res.headers['set-cookie']",
      "password",
      "token",
      "accessToken",
      "refreshToken",
      "tokenHash",
      "otp",
      "otpHash",
      "documentText",
      "ocrText",
      "extractedData",
      "nationalId",
      "filePath",
      "sessionToken",
      "session_url",
      "storageKey",
      "encryptionKey",
    ],
    censor: "[REDACTED]",
  },
});

module.exports = logger;
