const ApiError = require("../utils/ApiError");
const { verifyAccessToken } = require("../utils/jwt.util");
const { assertTokenActive } = require("../services/authIntrospection");

function readBearerToken(req) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    throw ApiError.unauthorized("Authentication token missing", "TOKEN_MISSING");
  }

  return token.trim();
}

module.exports = async function authenticate(req, res, next) {
  try {
    const token = readBearerToken(req);
    const payload = verifyAccessToken(token);
    const introspection = await assertTokenActive(token, payload);

    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      sessionId: payload.sid || null,
      authMode: "jwt",
      accountStatus: introspection?.accountStatus || "ACTIVE",
      mfaEnabled: introspection?.mfaEnabled === true,
      amr: Array.isArray(introspection?.amr)
        ? introspection.amr
        : Array.isArray(payload.amr)
          ? payload.amr
          : ["pwd"],
      stepUpAt: typeof introspection?.stepUpAt === "number" ? introspection.stepUpAt : null,
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
