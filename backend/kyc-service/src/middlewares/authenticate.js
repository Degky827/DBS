const ApiError = require("../utils/ApiError");
const { verifyAccessToken } = require("../utils/jwt.util");

function readBearerToken(req) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    throw ApiError.unauthorized("Authentication token missing", "TOKEN_MISSING");
  }

  return token.trim();
}

module.exports = function authenticate(req, res, next) {
  try {
    const token = readBearerToken(req);
    const payload = verifyAccessToken(token);

    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      authMode: "jwt",
    };

    return next();
  } catch (error) {
    if (error instanceof ApiError) {
      return next(error);
    }
    if (error.name === "TokenExpiredError") {
      return next(ApiError.unauthorized("Access token expired", "TOKEN_EXPIRED"));
    }
    if (error.name === "JsonWebTokenError" || error.name === "NotBeforeError") {
      return next(ApiError.unauthorized("Invalid access token", "INVALID_TOKEN"));
    }
    return next(error);
  }
};
