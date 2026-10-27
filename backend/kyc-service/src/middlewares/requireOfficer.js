const ApiError = require("../utils/ApiError");

const OFFICER_ROLES = new Set(["ADMIN", "OFFICER", "VERIFICATION_OFFICER"]);

module.exports = function requireOfficer(req, res, next) {
  if (!OFFICER_ROLES.has(req.user?.role)) {
    return next(ApiError.forbidden("Verification officer access required", "OFFICER_REQUIRED"));
  }
  return next();
};
