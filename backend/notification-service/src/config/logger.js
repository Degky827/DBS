const pino = require("pino");
const env = require("./env");

const logger = pino({
  level: env.LOG_LEVEL,
  base: {
    service: "notification-service",
    env: env.NODE_ENV,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'req.headers["set-cookie"]',
      'req.headers["x-internal-service-key"]',
      'req.headers["api-key"]',
      'req.headers["x-brevo-api-key"]',
      "res.headers.cookie",
      "res.headers['set-cookie']",
      "password",
      "token",
      "accessToken",
      "refreshToken",
      "tokenHash",
      "otp",
      "otpHash",
      "apiKey",
      "emailBody",
      "htmlContent",
      "textContent",
    ],
    censor: "[REDACTED]",
  },
});

module.exports = logger;
