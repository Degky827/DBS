const cors = require("cors");

const env = require("../config/env");

// CORS is only a browser-side control. Authorization and CSRF checks remain
// enforced by the application; this middleware never answers with a wildcard
// origin and never combines wildcard origins with credentials.
const corsMiddleware = cors({
  origin(origin, callback) {
    if (!origin) {
      // Non-browser callers do not send Origin. They are unaffected by CORS.
      return callback(null, false);
    }
    return callback(null, env.CORS_ORIGINS.includes(origin));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Authorization",
    "Content-Type",
    "Accept",
    "X-Request-Id",
    "X-CSRF-Token",
    "Idempotency-Key",
  ],
  exposedHeaders: ["Retry-After", "X-Request-Id"],
  maxAge: 600,
  optionsSuccessStatus: 204,
});

module.exports = corsMiddleware;
