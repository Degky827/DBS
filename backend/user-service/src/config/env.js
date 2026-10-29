const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

function fail(message) {
  console.error(`[config] ${message}`);
  process.exit(1);
}

function readRequired(key) {
  const value = process.env[key];
  if (!value || !String(value).trim()) {
    fail(`Missing required environment variable: ${key}`);
  }
  return String(value).trim();
}

function readOptional(key) {
  const value = process.env[key];
  return value === undefined ? "" : String(value).trim();
}

function readNumber(key, fallback) {
  const parsed = Number(process.env[key]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readInteger(key, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (process.env[key] === undefined || process.env[key] === "") return fallback;
  const parsed = Number(process.env[key]);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    fail(`${key} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

function readBoolean(key, fallback) {
  const value = process.env[key];
  if (value === undefined || value === "") return fallback;
  return !["false", "0", "no", "off"].includes(String(value).toLowerCase());
}

const WEAK_SECRETS = new Set([
  "secret",
  "password",
  "changeme",
  "change-me",
  "change-this-to-a-long-random-string",
  "dev-internal-service-key",
  "your-secret-key",
  "jwt-secret",
]);

function isStrongSecret(value, minimumLength = 32) {
  if (typeof value !== "string" || value.length < minimumLength) return false;
  if (WEAK_SECRETS.has(value.toLowerCase())) return false;
  if (new Set(value).size < 8) return false;
  return true;
}

function decodeKey(name, base64Name) {
  const base64Value = readOptional(base64Name);
  const rawValue = readOptional(name);
  const encoded = base64Value || rawValue;
  if (!encoded) return "";
  const pem = base64Value
    ? Buffer.from(base64Value, "base64").toString("utf8")
    : rawValue.replace(/\\n/g, "\n");
  return pem.trim();
}

function parseOrigins(rawValue, { production }) {
  const defaults = "http://localhost:5173,http://localhost:8080";
  const value = rawValue === undefined || rawValue === "" ? defaults : rawValue;
  if (value.includes("*")) {
    fail("CORS_ORIGIN must list explicit origins; wildcard CORS is not supported.");
  }

  const origins = value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    fail("CORS_ORIGIN must contain at least one trusted frontend origin.");
  }

  for (const origin of origins) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      fail(`CORS_ORIGIN contains an invalid origin: ${origin}`);
    }
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      !["http:", "https:"].includes(parsed.protocol)
    ) {
      fail(`CORS_ORIGIN entries must be bare http(s) origins: ${origin}`);
    }
    if (production && parsed.protocol !== "https:") {
      fail("CORS_ORIGIN entries must use HTTPS in production.");
    }
  }

  return Object.freeze([...new Set(origins)]);
}

const nodeEnv = process.env.NODE_ENV || "development";
const isProduction = nodeEnv === "production";

const authMode = (process.env.AUTH_MODE || "dev").toLowerCase();
if (!["dev", "jwt"].includes(authMode)) {
  fail(`Invalid AUTH_MODE "${process.env.AUTH_MODE}". Use "dev" or "jwt".`);
}

if (isProduction && authMode === "dev") {
  fail(
    "AUTH_MODE=dev is not allowed in production. Configure AUTH_MODE=jwt and integrate auth-service."
  );
}

const validateChapaUrl = (key, value, { allowLocalHttp = false } = {}) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${key} must be a valid URL.`);
  }

  const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(allowLocalHttp && isLocalhost && url.protocol === "http:"))
  ) {
    fail(`${key} must use HTTPS${allowLocalHttp ? " (except localhost)" : ""}.`);
  }
  return url.toString().replace(/\/+$/, "");
};

// JWT verification settings are only required when AUTH_MODE=jwt.
const jwtAlgorithm = (process.env.JWT_ALGORITHM || "HS256").toUpperCase();
if (!["HS256", "RS256"].includes(jwtAlgorithm)) {
  fail('JWT_ALGORITHM must be "HS256" or "RS256".');
}

const jwtSecret = readOptional("JWT_SECRET");
const jwtPublicKey = decodeKey("JWT_PUBLIC_KEY", "JWT_PUBLIC_KEY_BASE64");
const jwtIssuer = readOptional("JWT_ISSUER") || "auth-service";
const jwtAudience = readOptional("JWT_AUDIENCE") || "banking-system";

if (authMode === "jwt") {
  if (jwtAlgorithm === "RS256") {
    if (!jwtPublicKey) {
      fail("JWT_ALGORITHM=RS256 requires JWT_PUBLIC_KEY or JWT_PUBLIC_KEY_BASE64.");
    }
    try {
      require("crypto").createPublicKey(jwtPublicKey);
    } catch {
      fail("JWT_PUBLIC_KEY must be a valid PEM-encoded RSA public key.");
    }
  } else {
    if (!jwtSecret) {
      fail("AUTH_MODE=jwt with HS256 requires JWT_SECRET (must match auth-service).");
    }
    if (isProduction && !isStrongSecret(jwtSecret)) {
      fail("JWT_SECRET must be at least 32 characters of high-entropy data in production.");
    }
  }
}

const internalServiceKey = readOptional("INTERNAL_SERVICE_KEY");
const kycServiceUrl = readOptional("KYC_SERVICE_URL").replace(/\/+$/, "");
if (isProduction && kycServiceUrl && !isStrongSecret(internalServiceKey)) {
  fail(
    "INTERNAL_SERVICE_KEY must be at least 32 characters of high-entropy data in production when KYC_SERVICE_URL is configured."
  );
}

const corsOrigins = parseOrigins(process.env.CORS_ORIGIN, { production: isProduction });

const enableApiDocs = readBoolean("ENABLE_API_DOCS", !isProduction);
const apiDocsUsername = readOptional("API_DOCS_USERNAME");
const apiDocsPassword = readOptional("API_DOCS_PASSWORD");
if (isProduction && enableApiDocs) {
  if (!apiDocsUsername || !isStrongSecret(apiDocsPassword, 16)) {
    fail(
      "API documentation in production requires API_DOCS_USERNAME and a strong API_DOCS_PASSWORD (16+ characters)."
    );
  }
}

// --- Phase 3: reconciliation scheduler ---
const reconciliationEnabled = readBoolean("RECONCILIATION_ENABLED", false);
const reconciliationIntervalMs = readInteger(
  "RECONCILIATION_INTERVAL_MS",
  5 * 60 * 1000,
  { min: 1000, max: 24 * 60 * 60 * 1000 }
);
const reconciliationStaleMinutes = readInteger(
  "RECONCILIATION_STALE_MINUTES",
  15,
  { min: 1, max: 7 * 24 * 60 }
);
const reconciliationBatchSize = readInteger(
  "RECONCILIATION_BATCH_SIZE",
  25,
  { min: 1, max: 500 }
);

const enableHsts = readBoolean("ENABLE_HSTS", false);
if (enableHsts && !isProduction) {
  console.warn("[config] ENABLE_HSTS is set outside production; verify the deployment uses HTTPS.");
}

const trustProxy = readInteger("TRUST_PROXY", isProduction ? 1 : 0, { min: 0, max: 10 });

const avatarUploadDir = readOptional("AVATAR_UPLOAD_DIR");
const chapaSecretKey = readOptional("CHAPA_SECRET_KEY");
const chapaWebhookSecret = readOptional("CHAPA_WEBHOOK_SECRET");
const chapaBaseUrl = readOptional("CHAPA_BASE_URL") || "https://api.chapa.global";
const chapaCallbackUrl = readOptional("CHAPA_CALLBACK_URL");
const chapaReturnUrl = readOptional("CHAPA_RETURN_URL");

if (chapaSecretKey && !/^CHAPA_TEST_[A-Za-z0-9_-]+$/.test(chapaSecretKey)) {
  fail("CHAPA_SECRET_KEY must be a Chapa Test Mode private key (CHAPA_TEST_...).");
}

if (
  chapaSecretKey &&
  (!chapaWebhookSecret || chapaWebhookSecret.length < 16 || !chapaCallbackUrl || !chapaReturnUrl)
) {
  fail(
    "Configuring Chapa Test Mode requires CHAPA_WEBHOOK_SECRET (at least 16 characters), CHAPA_CALLBACK_URL, and CHAPA_RETURN_URL."
  );
}

let validatedChapaBaseUrl = "https://api.chapa.global";
let validatedChapaCallbackUrl = "";
let validatedChapaReturnUrl = "";
if (chapaSecretKey) {
  validatedChapaBaseUrl = validateChapaUrl("CHAPA_BASE_URL", chapaBaseUrl);
  const parsedBaseUrl = new URL(validatedChapaBaseUrl);
  if (
    parsedBaseUrl.hostname !== "api.chapa.global" ||
    parsedBaseUrl.pathname !== "/" ||
    parsedBaseUrl.search
  ) {
    fail("CHAPA_BASE_URL must be https://api.chapa.global.");
  }
  validatedChapaCallbackUrl = validateChapaUrl("CHAPA_CALLBACK_URL", chapaCallbackUrl, {
    allowLocalHttp: !isProduction,
  });
  validatedChapaReturnUrl = validateChapaUrl("CHAPA_RETURN_URL", chapaReturnUrl, {
    allowLocalHttp: !isProduction,
  });
}

const env = Object.freeze({
  NODE_ENV: nodeEnv,
  IS_PRODUCTION: isProduction,
  PORT: readNumber("PORT", 5002),
  DATABASE_URL: readRequired("DATABASE_URL"),
  DB_ADAPTER: (() => {
    const adapter = (process.env.DB_ADAPTER || "pg").toLowerCase();
    if (!["pg"].includes(adapter)) {
      fail(
        `Invalid DB_ADAPTER "${process.env.DB_ADAPTER}". User service currently supports "pg" only.`
      );
    }
    return adapter;
  })(),

  AUTH_MODE: authMode,
  DEV_SESSION_TTL_MS: readNumber("DEV_SESSION_TTL_MS", 8 * 60 * 60 * 1000),
  DEV_API_KEY: process.env.DEV_API_KEY || "",

  // --- auth-service integration (AUTH_MODE=jwt) ---
  JWT_ALGORITHM: jwtAlgorithm,
  JWT_SECRET: jwtSecret,
  JWT_PUBLIC_KEY: jwtPublicKey,
  JWT_ISSUER: jwtIssuer,
  JWT_AUDIENCE: jwtAudience,
  AUTH_SERVICE_URL: readOptional("AUTH_SERVICE_URL").replace(/\/+$/, ""),
  KYC_SERVICE_URL: kycServiceUrl,
  INTERNAL_SERVICE_KEY: internalServiceKey,
  AVATAR_UPLOAD_DIR: path.resolve(
    avatarUploadDir || path.resolve(__dirname, "../../uploads/avatars")
  ),

  BCRYPT_ROUNDS: readNumber("BCRYPT_ROUNDS", 12),
  CORS_ORIGINS: corsOrigins,
  TRUST_PROXY: trustProxy,
  ENABLE_HSTS: enableHsts,
  LOG_LEVEL: process.env.LOG_LEVEL || "info",
  RATE_LIMIT_WINDOW_MS: readNumber("RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
  RATE_LIMIT_MAX: readNumber("RATE_LIMIT_MAX", 300),
  AUTH_RATE_LIMIT_MAX: readNumber("AUTH_RATE_LIMIT_MAX", 20),
  ENABLE_API_DOCS: enableApiDocs,
  API_DOCS_USERNAME: apiDocsUsername,
  API_DOCS_PASSWORD: apiDocsPassword,

  // --- Reconciliation scheduler ---
  RECONCILIATION_ENABLED: reconciliationEnabled,
  RECONCILIATION_INTERVAL_MS: reconciliationIntervalMs,
  RECONCILIATION_STALE_MINUTES: reconciliationStaleMinutes,
  RECONCILIATION_BATCH_SIZE: reconciliationBatchSize,

  // --- Payment Provider (Chapa Test-Mode) ---
  CHAPA_SECRET_KEY: chapaSecretKey,
  CHAPA_WEBHOOK_SECRET: chapaWebhookSecret,
  CHAPA_BASE_URL: validatedChapaBaseUrl,
  CHAPA_CALLBACK_URL: validatedChapaCallbackUrl,
  CHAPA_RETURN_URL: validatedChapaReturnUrl,
});

module.exports = env;
