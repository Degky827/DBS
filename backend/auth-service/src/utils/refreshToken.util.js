const crypto = require("crypto");
const env = require("../config/env");

const generateRefreshToken = () => crypto.randomBytes(48).toString("hex");

const hashRefreshToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const refreshTokenExpiry = () => new Date(Date.now() + env.REFRESH_TOKEN_TTL_MS);

module.exports = { generateRefreshToken, hashRefreshToken, refreshTokenExpiry };
