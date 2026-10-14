const ApiError = require("../utils/ApiError");

module.exports = function notFound(req, res, next) {
  return next(
    ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`)
  );
};
