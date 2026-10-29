const jwt = require("jsonwebtoken");
const env = require("../config/env");
const ApiError = require("./ApiError");

// Verifies access tokens issued by auth-service. HS256 uses a shared secret;
// RS256 uses auth-service's public key so only the issuer holds signing key
// material. The algorithm is pinned to the configured value.
const verificationKey = () =>
  env.JWT_ALGORITHM === "RS256" ? env.JWT_PUBLIC_KEY : env.JWT_SECRET;

const verifyAccessToken = (token) => {
  try {
    const key = verificationKey();
    if (!key) {
      throw ApiError.internal("Access token verification key is not configured");
    }

    const payload = jwt.verify(token, key, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      algorithms: [env.JWT_ALGORITHM],
    });

    if (payload.typ !== "access") {
      throw ApiError.unauthorized("Invalid token type", "INVALID_TOKEN_TYPE");
    }

    if (typeof payload.sub !== "string" || !payload.sub) {
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
