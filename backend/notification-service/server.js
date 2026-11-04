const app = require("./src/app");
const env = require("./src/config/env");
const prisma = require("./src/config/database");
const logger = require("./src/config/logger");
const redis = require("./src/config/redis");
const { startEmailWorker, stopEmailWorker } = require("./src/services/email.worker");

if (redis.isConfigured()) {
  // Start the handshake in the background: a slow or absent Redis must not
  // delay startup, and readiness should report the connection it really has.
  redis.getReadyClient();
} else if (env.IS_PRODUCTION) {
  logger.warn(
    "REDIS_URL is unset: rate limits are counted per process, so every replica gets its own budget."
  );
}

const server = app.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, emailEnabled: env.EMAIL_ENABLED },
    "Notification service listening"
  );
  startEmailWorker();
});

let shuttingDown = false;

const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Notification service shutting down");

  stopEmailWorker();
  await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect().catch(() => {});
  await redis.shutdown().catch(() => {});
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

module.exports = server;
