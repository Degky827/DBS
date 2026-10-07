const ApiError = require("../utils/ApiError");

module.exports = function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user || !req.user.role || !roles.includes(req.user.role)) {
      return next(
        ApiError.forbidden("Insufficient permissions", "FORBIDDEN_ROLE")
      );
    }
    return next();
  };
};
