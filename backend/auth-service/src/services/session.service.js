const ApiError = require("../utils/ApiError");
const { verifyAccessToken } = require("../utils/jwt.util");
const userRepository = require("../repositories/user.repository");
const refreshTokenRepository = require("../repositories/refreshToken.repository");
const accessTokenRevocationRepository = require("../repositories/accessTokenRevocation.repository");
const { assertTokenUsable } = require("../utils/accountStatus");

// Verifies signature/expiry locally, then applies server-side revocation:
// a denylisted jti, a password change after the token was issued, or a dead
// refresh-token family referenced by sid. Throws ApiError.unauthorized when
// the token is no longer active.
const validateAccessToken = async (token) => {
  const payload = verifyAccessToken(token);

  if (payload.jti) {
    const revoked = await accessTokenRevocationRepository.isRevoked(payload.jti);
    if (revoked) {
      throw ApiError.unauthorized(
        "Access token has been revoked",
        "TOKEN_REVOKED"
      );
    }
  }

  const user = await userRepository.findById(payload.sub);
  if (!user) {
    throw ApiError.unauthorized("Account not found", "INVALID_TOKEN_SUBJECT");
  }

  assertTokenUsable(user);

  if (
    user.tokenValidAfter &&
    typeof payload.iat === "number" &&
    payload.iat * 1000 < user.tokenValidAfter.getTime()
  ) {
    throw ApiError.unauthorized(
      "Access token has been revoked",
      "TOKEN_REVOKED"
    );
  }

  if (payload.sid) {
    const family = await refreshTokenRepository.findActiveInFamily(payload.sid);
    if (!family || family.userId !== payload.sub) {
      throw ApiError.unauthorized(
        "Session has been revoked or expired",
        "SESSION_REVOKED"
      );
    }
  }

  return payload;
};

module.exports = { validateAccessToken };
