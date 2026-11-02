const env = require("../config/env");
const ApiError = require("../utils/ApiError");

// Adaptive step-up: accounts with MFA enabled must present a recently verified
// second factor for high-risk operations. Accounts without MFA are unchanged
// and are governed by their normal session lifetime.
module.exports = function requireStepUp(req, res, next) {
  const user = req.user;

  if (!user || user.authMode !== "jwt" || user.mfaEnabled !== true) {
    return next();
  }

  if (!Array.isArray(user.amr) || !user.amr.includes("mfa")) {
    return next(
      ApiError.forbidden(
        "Multi-factor authentication is required for this operation",
        "MFA_REQUIRED"
      )
    );
  }

  const verifiedAt = typeof user.stepUpAt === "number" ? user.stepUpAt : null;
  if (!verifiedAt || Date.now() - verifiedAt > env.STEP_UP_TTL_MS) {
    return next(
      ApiError.forbidden(
        "Re-verify your second factor to continue",
        "STEP_UP_REQUIRED"
      )
    );
  }

  return next();
};
