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
      'req.headers["set-cookie"]',
      'req.headers["x-dev-api-key"]',
      'req.headers["x-internal-service-key"]',
      "req.body.password",
      "req.body.currentPassword",
      "req.body.newPassword",
      "req.body.refreshToken",
      "req.body.accessToken",
      "req.body.otp",
      "password",
      "currentPassword",
      "newPassword",
      "passwordHash",
      "token",
      "accessToken",
      "refreshToken",
      "tokenHash",
      "otp",
      "otpHash",
      "codeHash",
      "res.headers.cookie",
      "res.headers['set-cookie']",
    ],
    censor: "[REDACTED]",
  },
});

module.exports = logger;
