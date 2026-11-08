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

const enableHsts = readBoolean("ENABLE_HSTS", false);
if (enableHsts && !isProduction) {
  console.warn("[config] ENABLE_HSTS is set outside production; verify the deployment uses HTTPS.");
}

const trustProxy = readInteger("TRUST_PROXY", isProduction ? 1 : 0, { min: 0, max: 10 });

// Optional bearer token for the private /metrics endpoint.
const metricsToken = readOptionalSecret("METRICS_TOKEN");

const brevoApiKey = readOptionalSecret("BREVO_API_KEY");
const sendgridApiKey = readOptionalSecret("SENDGRID_API_KEY");
const emailTransport = (
  process.env.EMAIL_TRANSPORT || (sendgridApiKey ? "sendgrid" : brevoApiKey ? "api" : "")
).toLowerCase();
if (emailTransport && !["api", "sendgrid"].includes(emailTransport)) {
  fail('EMAIL_TRANSPORT must be "api" (Brevo) or "sendgrid" when set.');
}
if (sendgridApiKey && !sendgridApiKey.startsWith("SG.")) {
  fail("SENDGRID_API_KEY must be a SendGrid API key (SG.).");
}

const emailEnabled = readBoolean("EMAIL_ENABLED", Boolean(brevoApiKey || sendgridApiKey));
const emailFromEmail = readOptional("EMAIL_FROM_EMAIL");
if (emailEnabled) {
  if (!brevoApiKey && !sendgridApiKey) {
    fail("EMAIL_ENABLED requires BREVO_API_KEY or SENDGRID_API_KEY (or their _FILE variants).");
  }
  if (!emailFromEmail) {
    fail("EMAIL_ENABLED requires EMAIL_FROM_EMAIL.");
  }
}
if (emailTransport === "sendgrid" && !sendgridApiKey) {
  fail("EMAIL_TRANSPORT=sendgrid requires SENDGRID_API_KEY.");
}

const sendgridApiBaseUrl = (
  process.env.SENDGRID_API_BASE_URL || "https://api.sendgrid.com"
).replace(/\/+$/, "");
if (!sendgridApiBaseUrl.startsWith("https://")) {
  fail("SENDGRID_API_BASE_URL must be an HTTPS URL.");
}

const brevoApiBaseUrl = (process.env.BREVO_API_BASE_URL || "https://api.brevo.com/v3").replace(
  /\/+$/,
  ""
);
try {
  const providerUrl = new URL(brevoApiBaseUrl);
  if (providerUrl.protocol !== "https:") {
    throw new Error("Brevo API base URL must use HTTPS");
  }
} catch {
  fail("BREVO_API_BASE_URL must be an HTTPS URL.");
}

const appOrigin = readOptional("APP_ORIGIN").replace(/\/+$/, "");

const env = Object.freeze({
  NODE_ENV: nodeEnv,
  IS_PRODUCTION: isProduction,
  PORT: readNumber("PORT", 5004),
  DATABASE_URL: readRequired("DATABASE_URL"),
  DB_ADAPTER: (() => {
    const adapter = (process.env.DB_ADAPTER || "pg").toLowerCase();
    if (!["pg"].includes(adapter)) {
      fail('Invalid DB_ADAPTER. Notification service currently supports "pg" only.');
    }
    return adapter;
  })(),
  JWT_ALGORITHM: jwtAlgorithm,
  JWT_SECRET: jwtSecret,
  JWT_PUBLIC_KEY: jwtPublicKey,
  JWT_ISSUER: process.env.JWT_ISSUER || "auth-service",
  JWT_AUDIENCE: process.env.JWT_AUDIENCE || "banking-system",
  INTERNAL_SERVICE_KEY: internalServiceKey,
  AUTH_SERVICE_URL: authServiceUrl || "http://localhost:5001/api/v1",
  CORS_ORIGINS: corsOrigins,
  TRUST_PROXY: trustProxy,
  METRICS_TOKEN: metricsToken,
  ENABLE_HSTS: enableHsts,
  LOG_LEVEL: process.env.LOG_LEVEL || "info",
  RATE_LIMIT_WINDOW_MS: readNumber("RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
  RATE_LIMIT_MAX: readNumber("RATE_LIMIT_MAX", 300),
  INTERNAL_RATE_LIMIT_MAX: readNumber("INTERNAL_RATE_LIMIT_MAX", 300),
  // Redis is optional: unset, every limiter counts this process alone.
  REDIS_URL: readOptional("REDIS_URL"),
  REDIS_KEY_PREFIX: readOptional("REDIS_KEY_PREFIX") || "notification",
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
  NOTIFICATION_PAGE_SIZE: readInteger("NOTIFICATION_PAGE_SIZE", 20, { min: 1, max: 100 }),
  EMAIL_ENABLED: emailEnabled,
  EMAIL_TRANSPORT: emailTransport || "api",
  BREVO_API_KEY: brevoApiKey,
  BREVO_API_BASE_URL: brevoApiBaseUrl,
  SENDGRID_API_KEY: sendgridApiKey,
  SENDGRID_API_BASE_URL: sendgridApiBaseUrl,
  EMAIL_FROM: readOptional("EMAIL_FROM") || "Meridian Bank",
  EMAIL_FROM_EMAIL: emailFromEmail,
  EMAIL_TIMEOUT_MS: readInteger("EMAIL_TIMEOUT_MS", 8000, { min: 1000, max: 60000 }),
  EMAIL_RETRY_INTERVAL_MS: readInteger("EMAIL_RETRY_INTERVAL_MS", 30000, {
    min: 5000,
    max: 60 * 60 * 1000,
  }),
  EMAIL_MAX_ATTEMPTS: readInteger("EMAIL_MAX_ATTEMPTS", 6, { min: 1, max: 50 }),
  APP_ORIGIN: appOrigin,
});

module.exports = env;
