const env = require("../config/env");
const logger = require("../config/logger");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");

const PRISMA_ERROR_MAP = {
  P2002: () =>
    ApiError.conflict("Resource already exists", "UNIQUE_CONSTRAINT"),
  P2025: () => ApiError.notFound("Resource not found", "RESOURCE_NOT_FOUND"),
  P2021: () => ApiError.notFound("Resource not found", "TABLE_NOT_FOUND"),
  P1017: () =>
    ApiError.internal("Database connection lost", { code: "DB_DISCONNECTED" }),
};

module.exports = function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  const originalError = err;
  let error =
    err instanceof ApiError
      ? err
      : PRISMA_ERROR_MAP[err && err.code]
        ? PRISMA_ERROR_MAP[err.code]()
        : null;

  if (!error) {
    error = ApiError.internal("Internal server error");
  }

  const logPayload = {
    requestId: req.id,
    method: req.method,
    url: req.originalUrl,
    statusCode: error.statusCode,
    code: error.code,
  };

  if (error.statusCode >= 500) {
    logger.error({ ...logPayload, err: originalError }, "Request failed");
  } else {
    logger.warn({ ...logPayload, reason: error.message }, "Request rejected");
  }

  const isServerError = error.statusCode >= 500;
  const message = isServerError && env.IS_PRODUCTION
    ? "Internal server error"
    : error.message;
  const details = isServerError && env.IS_PRODUCTION ? null : error.details;

  return ApiResponse.error(res, error.statusCode, message, details);
};
