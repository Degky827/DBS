const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const env = require("../config/env");
const ApiError = require("./ApiError");

const signingKey = () =>
  env.JWT_ALGORITHM === "RS256" ? env.JWT_PRIVATE_KEY : env.JWT_SECRET;

const verificationKey = () =>
  env.JWT_ALGORITHM === "RS256" ? env.JWT_PUBLIC_KEY : env.JWT_SECRET;

const sign = (payload, expiresIn) =>
  jwt.sign(payload, signingKey(), {
    algorithm: env.JWT_ALGORITHM,
    ...(env.JWT_KEY_ID ? { keyid: env.JWT_KEY_ID } : {}),
    expiresIn,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  });

const decode = (token, expectedType, { expiredMessage, invalidMessage }) => {
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

    if (payload.typ !== expectedType) {
      throw ApiError.unauthorized("Invalid token type", "INVALID_TOKEN_TYPE");
    }

    if (typeof payload.sub !== "string" || !payload.sub) {
      throw ApiError.unauthorized("Invalid token subject", "INVALID_TOKEN_SUBJECT");
    }

    return payload;
  } catch (error) {
    if (error instanceof ApiError) throw error;

    if (error.name === "TokenExpiredError") {
      throw ApiError.unauthorized(expiredMessage, "TOKEN_EXPIRED");
    }

    throw ApiError.unauthorized(invalidMessage, "INVALID_TOKEN");
  }
};

// sid ties every access token to the refresh-token family it was issued for,
// jti allows a single token to be revoked at logout, and stepUpAt records the
// last fresh MFA assertion so sensitive actions can require recent proof.
const signAccessToken = (
  user,
  { familyId, amr = ["pwd"], stepUpAt = null } = {}
) =>
  sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      typ: "access",
      jti: crypto.randomUUID(),
      amr,
      ...(stepUpAt ? { stepUpAt } : {}),
      ...(familyId ? { sid: familyId } : {}),
    },
    env.JWT_EXPIRES_IN
  );

const verifyAccessToken = (token) =>
  decode(token, "access", {
    expiredMessage: "Access token expired",
    invalidMessage: "Invalid access token",
  });

// Short-lived proof that the password factor succeeded. It cannot be used as
// an access token and is consumed after a successful TOTP check.
const signMfaChallengeToken = (user) =>
  sign(
    {
      sub: user.id,
      email: user.email,
      typ: "mfa",
      jti: crypto.randomUUID(),
      amr: ["pwd"],
    },
    Math.max(1, Math.floor(env.MFA_CHALLENGE_TTL_MS / 1000))
  );

const verifyMfaChallengeToken = (token) =>
  decode(token, "mfa", {
    expiredMessage: "Multi-factor challenge expired, sign in again",
    invalidMessage: "Invalid multi-factor challenge",
  });

module.exports = {
  signAccessToken,
  verifyAccessToken,
  signMfaChallengeToken,
  verifyMfaChallengeToken,
};
