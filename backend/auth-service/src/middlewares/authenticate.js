const ApiError = require("../utils/ApiError");
const { verifyAccessToken } = require("../utils/jwt.util");

module.exports = function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const [scheme, token] = header.split(" ");

    if (scheme !== "Bearer" || !token) {
      throw ApiError.unauthorized(
        "Authentication token missing",
        "TOKEN_MISSING"
      );
    }

    req.user = verifyAccessToken(token.trim());
    return next();
  } catch (error) {
    return next(error);
  }
};
