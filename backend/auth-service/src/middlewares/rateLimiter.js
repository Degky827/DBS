const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

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
  req.path === "/api/v1/health" || req.path === "/api/v1/ready";

const globalLimiter = rateLimit({
  ...commonOptions,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  skip: skipHealthChecks,
  handler: buildHandler("Too many requests, please try again later"),
});

const normalizeEmail = (req) =>
  typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";

// Failed logins are counted per client IP and account. Successful logins are
// not counted, so shared NAT deployments are not exhausted by normal use.
const loginLimiter = rateLimit({
  ...commonOptions,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.LOGIN_RATE_LIMIT_MAX,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${normalizeEmail(req)}`,
  handler: buildHandler("Too many sign-in attempts, please try again later"),
});

// Registration, OTP verification/resend, and password reset are lower-volume
// endpoints and receive a stricter per-IP budget than ordinary requests.
const sensitiveAuthLimiter = rateLimit({
  ...commonOptions,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.SENSITIVE_AUTH_RATE_LIMIT_MAX,
  handler: buildHandler("Too many authentication attempts, please try again later"),
});

// Session refresh is expected to run regularly (including on page reload and
// from several tabs) so it receives a separate, more generous budget.
const refreshLimiter = rateLimit({
  ...commonOptions,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.REFRESH_RATE_LIMIT_MAX,
  handler: buildHandler("Too many session refresh attempts, please try again later"),
});

module.exports = {
  globalLimiter,
  loginLimiter,
  sensitiveAuthLimiter,
  refreshLimiter,
};
