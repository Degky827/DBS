const crypto = require("crypto");
const env = require("../config/env");
const ApiError = require("../utils/ApiError");

// Guards endpoints only other services may call. The caller proves itself with
// the shared secret in X-Internal-Service-Key; the comparison is timing-safe so
// the header cannot be guessed byte by byte.
module.exports = function authenticateInternal(req, res, next) {
  try {
    if (!env.INTERNAL_SERVICE_KEY) {
      throw ApiError.forbidden("Internal endpoints are disabled", "INTERNAL_ENDPOINTS_DISABLED");
    }

    const provided = req.headers["x-internal-service-key"] || "";
    const expected = Buffer.from(String(env.INTERNAL_SERVICE_KEY));
    const actual = Buffer.from(String(provided));

    const valid = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

    if (!valid) {
      throw ApiError.unauthorized(
        "Invalid or missing X-Internal-Service-Key",
        "INVALID_INTERNAL_KEY"
      );
    }

    return next();
  } catch (error) {
    return next(error);
  }
};
