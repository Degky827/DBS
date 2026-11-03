const app = require("./src/app");
const env = require("./src/config/env");
const prisma = require("./src/config/database");
const logger = require("./src/config/logger");
const { startEmailWorker, stopEmailWorker } = require("./src/services/email.worker");

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
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

module.exports = server;
