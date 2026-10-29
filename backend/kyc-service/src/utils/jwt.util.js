const jwt = require("jsonwebtoken");
const env = require("../config/env");
const ApiError = require("./ApiError");

// Access tokens are issued by auth-service. HS256 uses a shared secret;
// RS256 uses auth-service's public key. The algorithm is pinned so tokens
// signed with a different algorithm are rejected.
const verificationKey = () =>
  env.JWT_ALGORITHM === "RS256" ? env.JWT_PUBLIC_KEY : env.JWT_SECRET;

function verifyAccessToken(token) {
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
}

module.exports = { verifyAccessToken };
