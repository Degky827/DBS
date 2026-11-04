const env = require("./src/config/env");
const app = require("./src/app");
const prisma = require("./src/config/database");
const logger = require("./src/config/logger");
const redis = require("./src/config/redis");

const MAX_DB_ATTEMPTS = 3;

async function connectDatabase() {
  for (let attempt = 1; attempt <= MAX_DB_ATTEMPTS; attempt += 1) {
    try {
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`;
      logger.info({ attempt }, "Database connection established");
      return;
    } catch (error) {
      logger.warn(
        { attempt, err: (error && error.message) || String(error) },
        "Database connection attempt failed"
      );

      if (attempt === MAX_DB_ATTEMPTS) {
        if (env.IS_PRODUCTION) {
          logger.fatal("Database unreachable - refusing to start in production");
          process.exit(1);
        }
        logger.warn("Starting without a verified database connection - check DATABASE_URL");
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
}

function registerShutdown(server) {
  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down gracefully...");

    const forceExit = setTimeout(() => {
      logger.error("Forced shutdown after timeout");
      process.exit(1);
    }, 10000);
    forceExit.unref();

    server.close(async () => {
      await prisma.$disconnect();
      await redis.shutdown();
      logger.info("Shutdown complete");
      process.exit(0);
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

async function start() {
  await connectDatabase();

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
    logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, "auth-service listening");
  });

  registerShutdown(server);
}

start().catch((error) => {
  logger.fatal({ err: error }, "Fatal startup error");
  process.exit(1);
});
