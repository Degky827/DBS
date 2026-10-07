const rateLimit = require("express-rate-limit");

const env = require("../config/env");
const ApiResponse = require("../utils/ApiResponse");

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
  ipv6Subnet: 56,
};

const globalLimiter = rateLimit({
  ...commonOptions,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  skip: (req) => req.path === "/api/v1/health" || req.path === "/api/v1/ready",
  handler: buildHandler("Too many requests, please try again later"),
});

const authLimiter = rateLimit({
  ...commonOptions,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX,
  handler: buildHandler(
    "Too many authentication attempts, please try again later"
  ),
});

module.exports = { globalLimiter, authLimiter };
