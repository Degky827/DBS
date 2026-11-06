const express = require("express");
const env = require("./config/env");
const prisma = require("./config/database");

const ROUTES = require("./constants/routes");
const v1Routes = require("./routes/v1");
const securityMiddlewares = require("./middlewares/security");
const corsMiddleware = require("./middlewares/cors");
const requestLogger = require("./middlewares/requestLogger");
const { globalLimiter, webhookLimiter } = require("./middlewares/rateLimiter");
const notFound = require("./middlewares/notFound");
const errorHandler = require("./middlewares/errorHandler");
const metrics = require("./utils/metrics");

const app = express();

// Only trust the configured number of reverse proxies so spoofed
// X-Forwarded-For headers cannot influence limiter and audit keys.
if (env.TRUST_PROXY > 0) {
  app.set("trust proxy", env.TRUST_PROXY);
}

app.disable("x-powered-by");

app.use(...securityMiddlewares);
app.use(requestLogger);

// Scraped by Prometheus over the internal network; excluded from request logs
// and rate limits so a scrape burst cannot throttle real traffic.
app.use(metrics.httpMiddleware());
app.get("/metrics", metrics.metricsHandler);

app.use(corsMiddleware);

const WEBHOOK_PATH = `${ROUTES.API_PREFIX}${ROUTES.PAYMENTS.WEBHOOK}`;

// Applied before body parsing so floods are rejected without buffering payloads.
app.use(WEBHOOK_PATH, webhookLimiter);

app.use(
  express.json({
    limit: "10kb",
    verify: (req, res, buf) => {
      // Compare the pathname only: originalUrl retains the query string, which
      // would otherwise suppress raw-body capture for the webhook.
      if (req.path === WEBHOOK_PATH) {
        req.rawBody = Buffer.from(buf);
      }
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: "10kb" }));

if (env.AVATAR_STORAGE_BACKEND === "postgres") {
  app.get("/uploads/avatars/:filename", async (req, res, next) => {
    const { filename } = req.params;
    if (!/^[a-f0-9-]+\.(jpg|png|webp)$/.test(filename)) {
      return res.status(404).end();
    }

    try {
      const avatar = await prisma.avatarBlob.findUnique({ where: { filename } });
      if (!avatar) return res.status(404).end();

      res.set("Content-Type", avatar.contentType);
      res.set("Cache-Control", "public, max-age=86400, immutable");
      res.set("X-Content-Type-Options", "nosniff");
      return res.send(Buffer.from(avatar.data));
    } catch (error) {
      return next(error);
    }
  });
} else {
  app.use(
    "/uploads/avatars",
    express.static(env.AVATAR_UPLOAD_DIR, {
      dotfiles: "deny",
      index: false,
      maxAge: "1d",
      immutable: true,
    })
  );
}

app.use(globalLimiter);

app.get("/", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "User service is running",
    data: {
      service: "user-service",
      version: "v1",
      authMode: env.AUTH_MODE,
      warning:
        env.AUTH_MODE === "dev"
          ? "Development authentication only — not production-ready"
          : undefined,
    },
  });
});

app.use(ROUTES.API_PREFIX, v1Routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
