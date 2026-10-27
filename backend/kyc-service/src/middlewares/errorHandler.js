const env = require("../config/env");
const logger = require("../config/logger");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");

const PRISMA_ERROR_MAP = {
  P2002: () => ApiError.conflict("Resource already exists", "UNIQUE_CONSTRAINT"),
  P2025: () => ApiError.notFound("Resource not found", "RESOURCE_NOT_FOUND"),
  P2021: () => ApiError.notFound("Resource not found", "TABLE_NOT_FOUND"),
  P1017: () => ApiError.internal("Database connection lost", { code: "DB_DISCONNECTED" }),
};

function mapRequestError(err) {
  if (err?.code === "LIMIT_FILE_SIZE") {
    return ApiError.payloadTooLarge("Uploaded file exceeds the size limit");
  }
  if (err?.name === "MulterError") {
    return ApiError.badRequest("Invalid document upload", "INVALID_UPLOAD");
  }
  if (err?.code === "UNSUPPORTED_DOCUMENT_FORMAT") {
    return ApiError.badRequest(
      "Only JPEG, PNG, and WebP document images are supported",
      "UNSUPPORTED_DOCUMENT_FORMAT"
    );
  }
  if (err?.type === "entity.too.large") {
    return ApiError.payloadTooLarge("Request payload is too large");
  }
  return null;
}

module.exports = function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  const originalError = err;
  let error = err instanceof ApiError ? err : PRISMA_ERROR_MAP[err && err.code] ? PRISMA_ERROR_MAP[err.code]() : null;
  error = error || mapRequestError(err);

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
  const message = isServerError && env.IS_PRODUCTION ? "Internal server error" : error.message;
  const details = isServerError && env.IS_PRODUCTION ? null : error.details;

  return ApiResponse.error(res, error.statusCode, message, details);
};
