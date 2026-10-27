const jwt = require("jsonwebtoken");
const env = require("../config/env");
const ApiError = require("./ApiError");

function verifyAccessToken(token) {
  const payload = jwt.verify(token, env.JWT_SECRET, {
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    algorithms: ["HS256"],
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
