const path = require("path");
const crypto = require("crypto");
const fs = require("fs");

require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

function fail(message) {
  console.error(`[config] ${message}`);
  process.exit(1);
}

// Docker/Kubernetes secrets are mounted as files. A `*_FILE` variable takes
// precedence so the secret never has to appear in the process environment.
function readFileValue(key) {
  const filePath = process.env[`${key}_FILE`];
  if (!filePath || !String(filePath).trim()) return null;
  try {
    return fs.readFileSync(String(filePath).trim(), "utf8").trim();
  } catch (error) {
    fail(`Unable to read ${key}_FILE (${filePath}): ${error.message}`);
  }
}

function readRequired(key) {
  const fileValue = readFileValue(key);
  const value = fileValue === null ? process.env[key] : fileValue;
  if (!value || !String(value).trim()) {
    fail(`Missing required environment variable: ${key} (or ${key}_FILE)`);
  }
  return String(value).trim();
}

function readOptional(key) {
  const value = process.env[key];
  return value === undefined ? "" : String(value).trim();
}

function readOptionalSecret(key) {
  const fileValue = readFileValue(key);
  return fileValue === null ? readOptional(key) : fileValue;
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

const jwtAlgorithm = (process.env.JWT_ALGORITHM || "HS256").toUpperCase();
if (!["HS256", "RS256"].includes(jwtAlgorithm)) {
  fail('JWT_ALGORITHM must be "HS256" or "RS256".');
}

const jwtSecret = readOptionalSecret("JWT_SECRET");
const jwtPublicKey = decodeKey("JWT_PUBLIC_KEY", "JWT_PUBLIC_KEY_BASE64");
if (jwtAlgorithm === "RS256") {
  if (!jwtPublicKey) {
    fail("JWT_ALGORITHM=RS256 requires JWT_PUBLIC_KEY or JWT_PUBLIC_KEY_BASE64.");
  }
  try {
    crypto.createPublicKey(jwtPublicKey);
  } catch {
    fail("JWT_PUBLIC_KEY must be a valid PEM-encoded RSA public key.");
  }
} else {
  if (!jwtSecret) {
    fail("JWT_ALGORITHM=HS256 requires JWT_SECRET.");
  }
  if (isProduction && !isStrongSecret(jwtSecret)) {
    fail("JWT_SECRET must be at least 32 characters of high-entropy data in production.");
  }
}

const internalServiceKey = readOptionalSecret("INTERNAL_SERVICE_KEY");
if (isProduction && !isStrongSecret(internalServiceKey)) {
  fail("INTERNAL_SERVICE_KEY must be at least 32 characters of high-entropy data in production.");
}

const authServiceUrl = readOptional("AUTH_SERVICE_URL").replace(/\/+$/, "");
if (isProduction && !authServiceUrl) {
  fail("AUTH_SERVICE_URL is required in production so revoked access tokens can be rejected.");
}

const corsOrigins = parseOrigins(process.env.CORS_ORIGIN, { production: isProduction });

const enableApiDocs = readBoolean("ENABLE_API_DOCS", !isProduction);
const apiDocsUsername = readOptional("API_DOCS_USERNAME");
const apiDocsPassword = readOptionalSecret("API_DOCS_PASSWORD");
if (isProduction && enableApiDocs) {
  if (!apiDocsUsername || !isStrongSecret(apiDocsPassword, 16)) {
    fail(
      "API documentation in production requires API_DOCS_USERNAME and a strong API_DOCS_PASSWORD (16+ characters)."
    );
  }
}

const enableHsts = readBoolean("ENABLE_HSTS", false);
if (enableHsts && !isProduction) {
  console.warn("[config] ENABLE_HSTS is set outside production; verify the deployment uses HTTPS.");
}

const trustProxy = readInteger("TRUST_PROXY", isProduction ? 1 : 0, { min: 0, max: 10 });

// Optional bearer token for the private /metrics endpoint. Prometheus runs on
// the backend network, but the token still protects against a shared network.
const metricsToken = readOptionalSecret("METRICS_TOKEN");

const kycApprovalTtlDays = readInteger("KYC_APPROVAL_TTL_DAYS", 365, {
  min: 1,
  max: 3650,
});

// --- Phase 4: event delivery and periodic re-verification ---
// Background work should run in one place: scale API replicas with
// ENABLE_JOBS=false and keep a single container that owns the jobs.
const jobsEnabled = readBoolean("ENABLE_JOBS", true);
// Tier re-verification notices reach customers through notification-service, so
// kyc-service keeps its own outbox table and dispatcher: a task and the
// notification asking the customer to act on it must commit together.
const notificationServiceUrl = readOptional("NOTIFICATION_SERVICE_URL").replace(/\/+$/, "");
const outboxEnabled = readBoolean(
  "OUTBOX_ENABLED",
  isProduction && Boolean(notificationServiceUrl)
);
const outboxIntervalMs = readInteger("OUTBOX_INTERVAL_MS", 5000, {
  min: 1000,
  max: 5 * 60 * 1000,
});
const outboxBatchSize = readInteger("OUTBOX_BATCH_SIZE", 25, { min: 1, max: 200 });
const outboxMaxAttempts = readInteger("OUTBOX_MAX_ATTEMPTS", 12, { min: 1, max: 100 });
if (outboxEnabled && !notificationServiceUrl) {
  fail("OUTBOX_ENABLED requires NOTIFICATION_SERVICE_URL.");
}
if (notificationServiceUrl && !isStrongSecret(internalServiceKey)) {
  if (isProduction) {
    fail(
      "NOTIFICATION_SERVICE_URL requires a strong INTERNAL_SERVICE_KEY so outbox events can be authenticated."
    );
  }
}

// The sweep only reads approvals and writes tasks, so it is safe to run on a
// six-hour cadence; officers see the queue, customers get a heads-up.
const reVerificationEnabled = readBoolean("KYC_REVERIFICATION_ENABLED", isProduction);
const reVerificationIntervalMs = readInteger("KYC_REVERIFICATION_INTERVAL_MS", 6 * 60 * 60 * 1000, {
  min: 15 * 60 * 1000,
  max: 24 * 60 * 60 * 1000,
});
const reVerificationBatchSize = readInteger("KYC_REVERIFICATION_BATCH_SIZE", 200, {
  min: 1,
  max: 2000,
});

const storageEncryptionKey = readOptionalSecret("STORAGE_ENCRYPTION_KEY");
if (storageEncryptionKey && !/^[a-f0-9]{64}$/i.test(storageEncryptionKey)) {
  fail("STORAGE_ENCRYPTION_KEY must be 64 hexadecimal characters.");
}
if (isProduction && !storageEncryptionKey) {
  fail("STORAGE_ENCRYPTION_KEY is required in production.");
}

// Retired keys stay readable during rotation so the re-encrypt job can run
// without downtime. Decryption tries the current key first, then these.
function parseEncryptionKeys(raw, name) {
  const keys = String(raw || "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  for (const key of keys) {
    if (!/^[a-f0-9]{64}$/i.test(key)) {
      fail(`${name} entries must be 64 hexadecimal characters.`);
    }
  }
  return Object.freeze([...new Set(keys.map((key) => key.toLowerCase()))]);
}

const previousStorageEncryptionKeys = parseEncryptionKeys(
  process.env.STORAGE_ENCRYPTION_KEYS_PREVIOUS,
  "STORAGE_ENCRYPTION_KEYS_PREVIOUS"
);
if (
  storageEncryptionKey &&
  previousStorageEncryptionKeys.includes(storageEncryptionKey.toLowerCase())
) {
  fail("STORAGE_ENCRYPTION_KEYS_PREVIOUS must not contain the current STORAGE_ENCRYPTION_KEY.");
}

// Hosts with an ephemeral filesystem (Render free, containers without a
// volume) keep encrypted documents in PostgreSQL instead of STORAGE_DIR.
const storageBackend = (process.env.STORAGE_BACKEND || "local").toLowerCase();
if (!["local", "postgres"].includes(storageBackend)) {
  fail('STORAGE_BACKEND must be "local" or "postgres".');
}

const diditApiBaseUrl = process.env.DIDIT_API_BASE_URL || "https://verification.didit.me";
try {
  const providerUrl = new URL(diditApiBaseUrl);
  if (providerUrl.protocol !== "https:" || providerUrl.hostname !== "verification.didit.me") {
    throw new Error("invalid Didit API origin");
  }
} catch {
  fail("DIDIT_API_BASE_URL must be https://verification.didit.me.");
}

const env = Object.freeze({
  NODE_ENV: nodeEnv,
  IS_PRODUCTION: isProduction,
  PORT: readNumber("PORT", 5003),
  DATABASE_URL: readRequired("DATABASE_URL"),
  DB_ADAPTER: (() => {
    const adapter = (process.env.DB_ADAPTER || "pg").toLowerCase();
    if (!["pg"].includes(adapter)) {
      fail(
        `Invalid DB_ADAPTER "${process.env.DB_ADAPTER}". KYC service currently supports "pg" only.`
      );
    }
    return adapter;
  })(),
  JWT_ALGORITHM: jwtAlgorithm,
  JWT_SECRET: jwtSecret,
  JWT_PUBLIC_KEY: jwtPublicKey,
  JWT_ISSUER: process.env.JWT_ISSUER || "auth-service",
  JWT_AUDIENCE: process.env.JWT_AUDIENCE || "banking-system",
  INTERNAL_SERVICE_KEY: internalServiceKey,
  USER_SERVICE_URL: (process.env.USER_SERVICE_URL || "http://localhost:5002/api/v1").replace(
    /\/+$/,
    ""
  ),
  AUTH_SERVICE_URL: authServiceUrl || "http://localhost:5001/api/v1",
  CORS_ORIGINS: corsOrigins,
  TRUST_PROXY: trustProxy,
  METRICS_TOKEN: metricsToken,
  ENABLE_HSTS: enableHsts,
  LOG_LEVEL: process.env.LOG_LEVEL || "info",
  RATE_LIMIT_WINDOW_MS: readNumber("RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
  RATE_LIMIT_MAX: readNumber("RATE_LIMIT_MAX", 300),
  UPLOAD_RATE_LIMIT_MAX: readNumber("UPLOAD_RATE_LIMIT_MAX", 10),
  WEBHOOK_RATE_LIMIT_MAX: readNumber("WEBHOOK_RATE_LIMIT_MAX", 120),
  AUTH_RATE_LIMIT_MAX: readNumber("AUTH_RATE_LIMIT_MAX", 20),
  // Redis is optional: unset, every limiter counts this process alone.
  REDIS_URL: readOptional("REDIS_URL"),
  REDIS_KEY_PREFIX: readOptional("REDIS_KEY_PREFIX") || "kyc",
  REDIS_COMMAND_TIMEOUT_MS: readInteger("REDIS_COMMAND_TIMEOUT_MS", 500, {
    min: 50,
    max: 5000,
  }),
  REDIS_CONNECT_TIMEOUT_MS: readInteger("REDIS_CONNECT_TIMEOUT_MS", 2000, {
    min: 100,
    max: 15000,
  }),
  REDIS_RECONNECT_PERIOD_MS: readInteger("REDIS_RECONNECT_PERIOD_MS", 5000, {
    min: 100,
    max: 60000,
  }),
  ENABLE_API_DOCS: enableApiDocs,
  API_DOCS_USERNAME: apiDocsUsername,
  API_DOCS_PASSWORD: apiDocsPassword,
  KYC_APPROVAL_TTL_DAYS: kycApprovalTtlDays,
  ENABLE_JOBS: jobsEnabled,
  NOTIFICATION_SERVICE_URL: notificationServiceUrl,
  OUTBOX_ENABLED: outboxEnabled,
  OUTBOX_INTERVAL_MS: outboxIntervalMs,
  OUTBOX_BATCH_SIZE: outboxBatchSize,
  OUTBOX_MAX_ATTEMPTS: outboxMaxAttempts,
  KYC_REVERIFICATION_ENABLED: reVerificationEnabled,
  KYC_REVERIFICATION_INTERVAL_MS: reVerificationIntervalMs,
  KYC_REVERIFICATION_BATCH_SIZE: reVerificationBatchSize,
  STORAGE_BACKEND: storageBackend,
  STORAGE_DIR: process.env.STORAGE_DIR || path.resolve(__dirname, "../../storage"),
  MAX_FILE_SIZE_BYTES: readNumber("MAX_FILE_SIZE_BYTES", 10 * 1024 * 1024),
  STORAGE_ENCRYPTION_KEY: storageEncryptionKey,
  STORAGE_ENCRYPTION_KEYS_PREVIOUS: previousStorageEncryptionKeys,
  DIDIT_API_BASE_URL: diditApiBaseUrl,
  DIDIT_API_KEY: readOptionalSecret("DIDIT_API_KEY"),
  DIDIT_WORKFLOW_ID: readOptional("DIDIT_WORKFLOW_ID"),
  DIDIT_WEBHOOK_SECRET: readOptionalSecret("DIDIT_WEBHOOK_SECRET"),
  DIDIT_WEBHOOK_SECRET_PREVIOUS: readOptionalSecret("DIDIT_WEBHOOK_SECRET_PREVIOUS"),
});

module.exports = env;
