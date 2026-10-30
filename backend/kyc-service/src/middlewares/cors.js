const cors = require("cors");

const env = require("../config/env");

// KYC APIs authenticate with the Authorization header; browser credentials
// (cookies) are not used and are deliberately disabled.
const corsMiddleware = cors({
  origin(origin, callback) {
    if (!origin) return callback(null, false);
    return callback(null, env.CORS_ORIGINS.includes(origin));
  },
  credentials: false,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type", "Accept", "X-Request-Id"],
  exposedHeaders: ["Retry-After", "X-Request-Id"],
  maxAge: 600,
  optionsSuccessStatus: 204,
});

module.exports = corsMiddleware;
