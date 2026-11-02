const crypto = require("crypto");
const env = require("../config/env");

const generateRefreshToken = () => crypto.randomBytes(48).toString("hex");

const hashRefreshToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

// A session may slide forward on rotation, but never past the absolute
// family deadline established at login.
const refreshTokenExpiry = (familyExpiresAt = null) => {
  const slidingExpiry = Date.now() + env.REFRESH_TOKEN_TTL_MS;
  if (!familyExpiresAt) return new Date(slidingExpiry);
  return new Date(Math.min(slidingExpiry, familyExpiresAt.getTime()));
};

const absoluteRefreshTokenExpiry = () =>
  new Date(Date.now() + env.REFRESH_TOKEN_ABSOLUTE_TTL_MS);

module.exports = {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  absoluteRefreshTokenExpiry,
};
