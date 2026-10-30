const ApiError = require("../utils/ApiError");

// Must run after authenticate. Roles come only from the verified session/JWT,
// never from request input.
module.exports = function requireRole(...roles) {
  const allowed = new Set(roles);
  return function requireRoleMiddleware(req, res, next) {
    if (!req.user || !allowed.has(req.user.role)) {
      return next(
        ApiError.forbidden(
          "This operation requires a privileged role",
          "FORBIDDEN_ROLE"
        )
      );
    }
    return next();
  };
};
