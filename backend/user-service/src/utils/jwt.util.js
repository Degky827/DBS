const jwt = require("jsonwebtoken");
const env = require("../config/env");
const ApiError = require("./ApiError");

// Verifies an access token issued by auth-service (Phase 1).
// Shares the HS256 secret, issuer and audience via environment configuration.
const verifyAccessToken = (token) => {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      algorithms: ["HS256"],
    });

    if (payload.typ !== "access") {
      throw ApiError.unauthorized("Invalid token type", "INVALID_TOKEN_TYPE");
    }

    if (!payload.sub) {
      throw ApiError.unauthorized("Invalid token subject", "INVALID_TOKEN_SUBJECT");
    }

    return payload;
  } catch (error) {
    if (error instanceof ApiError) throw error;

    if (error.name === "TokenExpiredError") {
      throw ApiError.unauthorized("Access token expired", "TOKEN_EXPIRED");
    }

    throw ApiError.unauthorized("Invalid access token", "INVALID_TOKEN");
  }
};

module.exports = { verifyAccessToken };
