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

const env = Object.freeze({
  NODE_ENV: process.env.NODE_ENV || "development",
  IS_PRODUCTION: (process.env.NODE_ENV || "development") === "production",
  PORT: readNumber("PORT", 5003),
  DATABASE_URL: readRequired("DATABASE_URL"),
  DB_ADAPTER: (() => {
    const adapter = (process.env.DB_ADAPTER || "pg").toLowerCase();
    if (!["pg"].includes(adapter)) {
      console.error(`[config] Invalid DB_ADAPTER "${process.env.DB_ADAPTER}". KYC service currently supports "pg" only.`);
      process.exit(1);
    }
    return adapter;
  })(),
  JWT_SECRET: readRequired("JWT_SECRET"),
  JWT_ISSUER: process.env.JWT_ISSUER || "auth-service",
  JWT_AUDIENCE: process.env.JWT_AUDIENCE || "banking-system",
  INTERNAL_SERVICE_KEY: process.env.INTERNAL_SERVICE_KEY || "",
  USER_SERVICE_URL: (process.env.USER_SERVICE_URL || "http://localhost:5002/api/v1").replace(/\/+$/, ""),
  AUTH_SERVICE_URL: (process.env.AUTH_SERVICE_URL || "http://localhost:5001/api/v1").replace(/\/+$/, ""),
  CORS_ORIGIN: process.env.CORS_ORIGIN || "*",
  LOG_LEVEL: process.env.LOG_LEVEL || "info",
  RATE_LIMIT_WINDOW_MS: readNumber("RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
  RATE_LIMIT_MAX: readNumber("RATE_LIMIT_MAX", 300),
  UPLOAD_RATE_LIMIT_MAX: readNumber("UPLOAD_RATE_LIMIT_MAX", 10),
  AUTH_RATE_LIMIT_MAX: readNumber("AUTH_RATE_LIMIT_MAX", 20),
  ENABLE_API_DOCS: readBoolean("ENABLE_API_DOCS", true),
  STORAGE_DIR: process.env.STORAGE_DIR || path.resolve(__dirname, "../../storage"),
  MAX_FILE_SIZE_BYTES: readNumber("MAX_FILE_SIZE_BYTES", 10 * 1024 * 1024),
  STORAGE_ENCRYPTION_KEY: process.env.STORAGE_ENCRYPTION_KEY || "",
  DIDIT_API_BASE_URL: process.env.DIDIT_API_BASE_URL || "https://verification.didit.me",
  DIDIT_API_KEY: process.env.DIDIT_API_KEY || "",
  DIDIT_WORKFLOW_ID: process.env.DIDIT_WORKFLOW_ID || "",
  DIDIT_WEBHOOK_SECRET: process.env.DIDIT_WEBHOOK_SECRET || "",
  DIDIT_WEBHOOK_SECRET_PREVIOUS: process.env.DIDIT_WEBHOOK_SECRET_PREVIOUS || "",
});

if (
  env.STORAGE_ENCRYPTION_KEY &&
  !/^[a-f0-9]{64}$/i.test(env.STORAGE_ENCRYPTION_KEY)
) {
  console.error("[config] STORAGE_ENCRYPTION_KEY must be 64 hexadecimal characters.");
  process.exit(1);
}

if (env.IS_PRODUCTION && !env.STORAGE_ENCRYPTION_KEY) {
  console.error("[config] STORAGE_ENCRYPTION_KEY is required in production.");
  process.exit(1);
}

if (
  env.IS_PRODUCTION &&
  (env.JWT_SECRET.length < 32 ||
    ["change-this-to-a-long-random-string", "secret", "password"].includes(
      env.JWT_SECRET.toLowerCase()
    ))
) {
  console.error("[config] JWT_SECRET must be a strong shared auth-service secret in production.");
  process.exit(1);
}

try {
  const providerUrl = new URL(env.DIDIT_API_BASE_URL);
  if (providerUrl.protocol !== "https:" || providerUrl.hostname !== "verification.didit.me") {
    throw new Error("invalid Didit API origin");
  }
} catch {
  console.error("[config] DIDIT_API_BASE_URL must be https://verification.didit.me.");
  process.exit(1);
}

module.exports = env;
