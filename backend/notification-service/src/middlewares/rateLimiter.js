const { rateLimit } = require("express-rate-limit");

const env = require("../config/env");
const ApiResponse = require("../utils/ApiResponse");
const { createRateLimitStore } = require("./rateLimitStore");

const buildHandler = (message) => (req, res) => {
  const retryAfter = Math.ceil(
    (req.rateLimit.resetTime ? new Date(req.rateLimit.resetTime).getTime() - Date.now() : 0) / 1000
  );

  res.setHeader("Retry-After", String(Math.max(retryAfter, 1)));

  return ApiResponse.error(res, 429, message, {
    retryAfter: Math.max(retryAfter, 1),
  });
};

const commonOptions = {
  standardHeaders: "draft-7",
  legacyHeaders: false,
};

const skipHealthChecks = (req) => req.path === "/api/v1/health" || req.path === "/api/v1/ready";

const globalLimiter = rateLimit({
  ...commonOptions,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  store: createRateLimitStore("global"),
  skip: skipHealthChecks,
  handler: buildHandler("Too many requests, please try again later"),
});

// Internal event delivery comes from user-service only, but the limit still
// protects the consumer from a misconfigured dispatcher loop.
const internalLimiter = rateLimit({
  ...commonOptions,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.INTERNAL_RATE_LIMIT_MAX,
  store: createRateLimitStore("internal"),
  handler: buildHandler("Too many internal notification requests, please try again later"),
});

module.exports = { globalLimiter, internalLimiter };
