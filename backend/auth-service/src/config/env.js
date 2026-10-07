const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

function readRequired(key) {
  const value = process.env[key];
  if (!value || !String(value).trim()) {
    console.error(`[config] Missing required environment variable: ${key}`);
    process.exit(1);
  }
  return String(value).trim();
}

function readNumber(key, fallback) {
  const parsed = Number(process.env[key]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readBoolean(key, fallback) {
  const value = process.env[key];
  if (value === undefined || value === "") return fallback;
  return !["false", "0", "no", "off"].includes(String(value).toLowerCase());
}

const nodeEnv = process.env.NODE_ENV || "development";

const env = Object.freeze({
  NODE_ENV: nodeEnv,
  IS_PRODUCTION: nodeEnv === "production",
  PORT: readNumber("PORT", 5001),
  DATABASE_URL: readRequired("DATABASE_URL"),
  DB_ADAPTER: (() => {
    const adapter = (process.env.DB_ADAPTER || "pg").toLowerCase();
    if (!["pg", "neon"].includes(adapter)) {
      console.error(
        `[config] Invalid DB_ADAPTER "${process.env.DB_ADAPTER}". Use "pg" (TCP) or "neon" (WebSocket).`
      );
      process.exit(1);
    }
    return adapter;
  })(),
  JWT_SECRET: readRequired("JWT_SECRET"),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "15m",
  JWT_ISSUER: process.env.JWT_ISSUER || "auth-service",
  JWT_AUDIENCE: process.env.JWT_AUDIENCE || "banking-system",
  BCRYPT_ROUNDS: readNumber("BCRYPT_ROUNDS", 12),
  CORS_ORIGIN: process.env.CORS_ORIGIN || "*",
  LOG_LEVEL: process.env.LOG_LEVEL || "info",
  RATE_LIMIT_WINDOW_MS: readNumber("RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
  RATE_LIMIT_MAX: readNumber("RATE_LIMIT_MAX", 300),
  AUTH_RATE_LIMIT_MAX: readNumber("AUTH_RATE_LIMIT_MAX", 10),
  ENABLE_API_DOCS: readBoolean("ENABLE_API_DOCS", true),
});

module.exports = env;
