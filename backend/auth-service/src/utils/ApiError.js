class ApiError extends Error {
  constructor(statusCode, message, code = "INTERNAL_ERROR", details = null) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = "Bad request", details = null) {
    return new ApiError(400, message, "BAD_REQUEST", details);
  }

  static validation(details = null) {
    return new ApiError(400, "Validation failed", "VALIDATION_ERROR", details);
  }

  static unauthorized(message = "Unauthorized", code = "UNAUTHORIZED") {
    return new ApiError(401, message, code);
  }

  static forbidden(message = "Forbidden", code = "FORBIDDEN") {
    return new ApiError(403, message, code);
  }

  static notFound(message = "Resource not found", code = "NOT_FOUND") {
    return new ApiError(404, message, code);
  }

  static conflict(message = "Conflict", code = "CONFLICT", details = null) {
    return new ApiError(409, message, code, details);
  }

  static tooManyRequests(message = "Too many requests", code = "RATE_LIMITED") {
    return new ApiError(429, message, code);
  }

  static internal(message = "Internal server error", details = null) {
    return new ApiError(500, message, "INTERNAL_ERROR", details);
  }
}

module.exports = ApiError;
