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
const isProduction = nodeEnv === "production";

const authMode = (process.env.AUTH_MODE || "dev").toLowerCase();
if (!["dev", "jwt"].includes(authMode)) {
  console.error(
    `[config] Invalid AUTH_MODE "${process.env.AUTH_MODE}". Use "dev" or "jwt".`
  );
  process.exit(1);
}

if (isProduction && authMode === "dev") {
  console.error(
    "[config] AUTH_MODE=dev is not allowed in production. Integrate JWT with auth-service before deploying."
  );
  process.exit(1);
}

const readOptional = (key) => {
  const value = process.env[key];
  return value === undefined ? "" : String(value).trim();
};

// JWT verification settings are only required when AUTH_MODE=jwt.
const jwtSecret = readOptional("JWT_SECRET");
const jwtIssuer = readOptional("JWT_ISSUER") || "auth-service";
const jwtAudience = readOptional("JWT_AUDIENCE") || "banking-system";
const avatarUploadDir = readOptional("AVATAR_UPLOAD_DIR");

if (authMode === "jwt" && !jwtSecret) {
  console.error(
    "[config] AUTH_MODE=jwt requires JWT_SECRET (must match auth-service)."
  );
  process.exit(1);
}

const env = Object.freeze({
  NODE_ENV: nodeEnv,
  IS_PRODUCTION: isProduction,
  PORT: readNumber("PORT", 5002),
  DATABASE_URL: readRequired("DATABASE_URL"),
  DB_ADAPTER: (() => {
    const adapter = (process.env.DB_ADAPTER || "pg").toLowerCase();
    if (!["pg"].includes(adapter)) {
      console.error(
        `[config] Invalid DB_ADAPTER "${process.env.DB_ADAPTER}". User service currently supports "pg" only.`
      );
      process.exit(1);
    }
    return adapter;
  })(),

  AUTH_MODE: authMode,
  DEV_SESSION_TTL_MS: readNumber("DEV_SESSION_TTL_MS", 8 * 60 * 60 * 1000),
  DEV_API_KEY: process.env.DEV_API_KEY || "",

  // --- auth-service integration (AUTH_MODE=jwt) ---
  JWT_SECRET: jwtSecret,
  JWT_ISSUER: jwtIssuer,
  JWT_AUDIENCE: jwtAudience,
  AUTH_SERVICE_URL: readOptional("AUTH_SERVICE_URL").replace(/\/+$/, ""),
  INTERNAL_SERVICE_KEY: readOptional("INTERNAL_SERVICE_KEY"),
  AVATAR_UPLOAD_DIR:
    path.resolve(
      avatarUploadDir || path.resolve(__dirname, "../../uploads/avatars")
    ),

  BCRYPT_ROUNDS: readNumber("BCRYPT_ROUNDS", 12),
  CORS_ORIGIN: process.env.CORS_ORIGIN || "*",
  LOG_LEVEL: process.env.LOG_LEVEL || "info",
  RATE_LIMIT_WINDOW_MS: readNumber("RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
  RATE_LIMIT_MAX: readNumber("RATE_LIMIT_MAX", 300),
  AUTH_RATE_LIMIT_MAX: readNumber("AUTH_RATE_LIMIT_MAX", 20),
  ENABLE_API_DOCS: readBoolean("ENABLE_API_DOCS", true),
});

module.exports = env;
