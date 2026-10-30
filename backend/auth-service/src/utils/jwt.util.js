const jwt = require("jsonwebtoken");
const env = require("../config/env");
const ApiError = require("./ApiError");

const signingKey = () =>
  env.JWT_ALGORITHM === "RS256" ? env.JWT_PRIVATE_KEY : env.JWT_SECRET;

const verificationKey = () =>
  env.JWT_ALGORITHM === "RS256" ? env.JWT_PUBLIC_KEY : env.JWT_SECRET;

const signAccessToken = (user) =>
  jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      typ: "access",
    },
    signingKey(),
    {
      algorithm: env.JWT_ALGORITHM,
      ...(env.JWT_KEY_ID ? { keyid: env.JWT_KEY_ID } : {}),
      expiresIn: env.JWT_EXPIRES_IN,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    }
  );

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

module.exports = { signAccessToken, verifyAccessToken };
