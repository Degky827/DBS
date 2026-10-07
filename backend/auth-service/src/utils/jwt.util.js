const jwt = require("jsonwebtoken");
const env = require("../config/env");
const ApiError = require("./ApiError");

const signAccessToken = (user) =>
  jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      typ: "access",
    },
    env.JWT_SECRET,
    {
      expiresIn: env.JWT_EXPIRES_IN,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    }
  );

const verifyAccessToken = (token) => {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    });

    if (payload.typ !== "access") {
      throw ApiError.unauthorized("Invalid token type", "INVALID_TOKEN_TYPE");
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
