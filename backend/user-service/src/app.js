const express = require("express");
const env = require("./config/env");

const ROUTES = require("./constants/routes");
const v1Routes = require("./routes/v1");
const securityMiddlewares = require("./middlewares/security");
const corsMiddleware = require("./middlewares/cors");
const requestLogger = require("./middlewares/requestLogger");
const { globalLimiter } = require("./middlewares/rateLimiter");
const notFound = require("./middlewares/notFound");
const errorHandler = require("./middlewares/errorHandler");

const app = express();

// Only trust the configured number of reverse proxies so spoofed
// X-Forwarded-For headers cannot influence limiter and audit keys.
if (env.TRUST_PROXY > 0) {
  app.set("trust proxy", env.TRUST_PROXY);
}

app.disable("x-powered-by");

app.use(...securityMiddlewares);
app.use(requestLogger);

app.use(corsMiddleware);

const WEBHOOK_PATH = `${ROUTES.API_PREFIX}${ROUTES.PAYMENTS.WEBHOOK}`;

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
app.use(
  "/uploads/avatars",
  express.static(env.AVATAR_UPLOAD_DIR, {
    dotfiles: "deny",
    index: false,
    maxAge: "1d",
    immutable: true,
  })
);

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
