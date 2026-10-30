const env = require("../config/env");
const ApiError = require("../utils/ApiError");

// Cookie-authenticated endpoints are state-changing POSTs. Browsers send an
// Origin (or at least a Referer) for them; a request that cannot be tied to a
// trusted frontend origin is rejected as CSRF. SameSite=... provides an
// additional, independent layer.
module.exports = function requireTrustedOrigin(req, res, next) {
  let origin = req.get("origin");

  if (!origin) {
    const referer = req.get("referer");
    if (referer) {
      try {
        origin = new URL(referer).origin;
      } catch {
        origin = null;
      }
    }
  }

  if (!origin) {
    return next(
      ApiError.forbidden(
        "Request origin could not be verified",
        "CSRF_ORIGIN_REQUIRED"
      )
    );
  }

  if (!env.CORS_ORIGINS.includes(origin)) {
    return next(
      ApiError.forbidden("Request origin is not allowed", "CSRF_ORIGIN_REJECTED")
    );
  }

  return next();
};
