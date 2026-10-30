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

// Only trust the configured number of reverse proxies. A value of 0 leaves
// Express' default so spoofed X-Forwarded-For headers cannot bypass limiter keys.
if (env.TRUST_PROXY > 0) {
  app.set("trust proxy", env.TRUST_PROXY);
}

app.disable("x-powered-by");

app.use(...securityMiddlewares);
app.use(requestLogger);

app.use(corsMiddleware);

app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));

app.use(globalLimiter);

app.get("/", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Auth service is running",
    data: { service: "auth-service", version: "v1" },
  });
});

app.use(ROUTES.API_PREFIX, v1Routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
