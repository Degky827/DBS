const crypto = require("crypto");
const env = require("../config/env");

const generateDevSessionToken = () => crypto.randomBytes(48).toString("hex");

const hashDevSessionToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const devSessionExpiry = () =>
  new Date(Date.now() + env.DEV_SESSION_TTL_MS);

module.exports = {
  generateDevSessionToken,
  hashDevSessionToken,
  devSessionExpiry,
};
