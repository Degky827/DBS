const pino = require("pino");
const env = require("./env");

const logger = pino({
  level: env.LOG_LEVEL,
  base: {
    service: "auth-service",
    env: env.NODE_ENV,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'req.headers["set-cookie"]',
      'req.headers["x-internal-service-key"]',
      'req.headers["x-dev-api-key"]',
      "req.body.password",
      "req.body.currentPassword",
      "req.body.newPassword",
      "req.body.refreshToken",
      "req.body.accessToken",
      "req.body.otp",
      "req.body.securityAnswer",
      "password",
      "passwordHash",
      "currentPassword",
      "accessToken",
      "refreshToken",
      "token",
      "tokenHash",
      "replacedByTokenHash",
      "otp",
      "otpHash",
      "codeHash",
      "newPassword",
      "securityAnswer",
      "securityAnswerHash",
      "res.headers['set-cookie']",
      "res.headers.cookie",
    ],
    censor: "[REDACTED]",
  },
});

module.exports = logger;
