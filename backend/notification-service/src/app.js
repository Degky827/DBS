const express = require("express");

const env = require("./config/env");
const v1Routes = require("./routes/v1");
const securityMiddlewares = require("./middlewares/security");
const corsMiddleware = require("./middlewares/cors");
const requestLogger = require("./middlewares/requestLogger");
const { globalLimiter } = require("./middlewares/rateLimiter");
const notFound = require("./middlewares/notFound");
const errorHandler = require("./middlewares/errorHandler");
const metrics = require("./utils/metrics");

const app = express();

if (env.TRUST_PROXY > 0) {
  app.set("trust proxy", env.TRUST_PROXY);
}

app.disable("x-powered-by");

app.use(...securityMiddlewares);
app.use(requestLogger);

app.use(metrics.httpMiddleware());
app.get("/metrics", metrics.metricsHandler);

app.use(corsMiddleware);
app.use(express.json({ limit: "64kb" }));
app.use(globalLimiter);

app.get("/", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Notification service is running",
    data: { service: "notification-service", version: "v1" },
  });
});

app.use("/api/v1", v1Routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
