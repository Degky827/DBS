const express = require("express");
const cors = require("cors");

const env = require("./config/env");
const v1Routes = require("./routes/v1");
const webhookRoutes = require("./routes/v1/webhook.routes");
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
    origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(",").map((origin) => origin.trim()),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  })
);

app.use(
  "/api/v1/kyc/webhooks",
  express.raw({ type: "application/json", limit: "1mb" }),
  webhookRoutes
);
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));
app.use(globalLimiter);

app.get("/", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "KYC service is running",
    data: { service: "kyc-service", version: "v1" },
  });
});

app.use("/api/v1/kyc", v1Routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
