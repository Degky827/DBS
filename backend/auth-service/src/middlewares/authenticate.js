const ApiError = require("../utils/ApiError");
const { validateAccessToken } = require("../services/session.service");

module.exports = async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const [scheme, token] = header.split(" ");

    if (scheme !== "Bearer" || !token) {
      throw ApiError.unauthorized(
        "Authentication token missing",
        "TOKEN_MISSING"
      );
    }

    req.user = await validateAccessToken(token.trim());
    return next();
  } catch (error) {
    return next(error);
  }
};
