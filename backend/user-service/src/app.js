const express = require("express");
const cors = require("cors");
const env = require("./config/env");

const ROUTES = require("./constants/routes");
const v1Routes = require("./routes/v1");
const securityMiddlewares = require("./middlewares/security");
const requestLogger = require("./middlewares/requestLogger");
const { globalLimiter } = require("./middlewares/rateLimiter");
const notFound = require("./middlewares/notFound");
const errorHandler = require("./middlewares/errorHandler");

const app = express();

if (env.IS_PRODUCTION) {
  app.set("trust proxy", 1);
}

app.disable("x-powered-by");

app.use(...securityMiddlewares);
app.use(requestLogger);

app.use(
  cors({
    origin:
      env.CORS_ORIGIN === "*"
        ? true
        : env.CORS_ORIGIN.split(",").map((origin) => origin.trim()),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  })
);

app.use(
  express.json({
    limit: "10kb",
    verify: (req, res, buf) => {
      if (req.originalUrl === `${ROUTES.API_PREFIX}${ROUTES.PAYMENTS.WEBHOOK}`) {
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
