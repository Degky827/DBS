const { rateLimit } = require("express-rate-limit");

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
};

const skipHealthChecks = (req) =>
  req.path === "/api/v1/kyc/health" || req.path === "/api/v1/kyc/ready";

const globalLimiter = rateLimit({
  ...commonOptions,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  skip: skipHealthChecks,
  handler: buildHandler("Too many requests, please try again later"),
});

// Document uploads are expensive (image processing and OCR), so they receive a
// stricter per-IP budget than ordinary API calls.
const uploadLimiter = rateLimit({
  ...commonOptions,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.UPLOAD_RATE_LIMIT_MAX,
  handler: buildHandler("Too many document uploads, please try again later"),
});

module.exports = { globalLimiter, uploadLimiter };
