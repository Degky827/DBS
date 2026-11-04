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
  const base64Value = readOptionalSecret(base64Name);
  const rawValue = readOptionalSecret(name);
  const encoded = base64Value || rawValue;
  if (!encoded) return "";
  const pem = base64Value
    ? Buffer.from(base64Value, "base64").toString("utf8")
    : rawValue.replace(/\\n/g, "\n");
  return pem.trim();
}

function validateKeyPair({ privateKey, publicKey, algorithm }) {
  if (algorithm !== "RS256") return;
  try {
    crypto.createPrivateKey(privateKey);
  } catch {
    fail("JWT_PRIVATE_KEY must be a valid PEM-encoded RSA private key for JWT_ALGORITHM=RS256.");
  }
  try {
    crypto.createPublicKey(publicKey);
  } catch {
    fail("JWT_PUBLIC_KEY must be a valid PEM-encoded RSA public key.");
  }
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
const jwtPrivateKey = decodeKey("JWT_PRIVATE_KEY", "JWT_PRIVATE_KEY_BASE64");
const jwtPublicKey = decodeKey("JWT_PUBLIC_KEY", "JWT_PUBLIC_KEY_BASE64");

if (jwtAlgorithm === "RS256") {
  if (!jwtPrivateKey) {
    fail("JWT_ALGORITHM=RS256 requires JWT_PRIVATE_KEY or JWT_PRIVATE_KEY_BASE64.");
  }
  if (!jwtPublicKey) {
    fail("JWT_ALGORITHM=RS256 requires JWT_PUBLIC_KEY or JWT_PUBLIC_KEY_BASE64.");
  }
  validateKeyPair({ privateKey: jwtPrivateKey, publicKey: jwtPublicKey, algorithm: jwtAlgorithm });
} else if (!jwtSecret) {
  fail("JWT_ALGORITHM=HS256 requires JWT_SECRET.");
}

if (isProduction && jwtAlgorithm === "HS256" && !isStrongSecret(jwtSecret)) {
  fail("JWT_SECRET must be at least 32 characters of high-entropy data in production.");
}

const internalServiceKey = readOptionalSecret("INTERNAL_SERVICE_KEY");
if (isProduction && !isStrongSecret(internalServiceKey)) {
  fail("INTERNAL_SERVICE_KEY must be at least 32 characters of high-entropy data in production.");
}

const corsOrigins = parseOrigins(process.env.CORS_ORIGIN, { production: isProduction });

const cookieSecure = readBoolean("COOKIE_SECURE", isProduction);
if (isProduction && !cookieSecure && !readBoolean("ALLOW_INSECURE_COOKIES", false)) {
  fail(
    "COOKIE_SECURE must be true in production (set ALLOW_INSECURE_COOKIES=true only for isolated HTTP testing)."
  );
}

const cookieSameSite = (process.env.REFRESH_COOKIE_SAME_SITE || "lax").toLowerCase();
if (!["lax", "strict", "none"].includes(cookieSameSite)) {
  fail('REFRESH_COOKIE_SAME_SITE must be "lax", "strict", or "none".');
}
if (cookieSameSite === "none" && !cookieSecure) {
  fail("REFRESH_COOKIE_SAME_SITE=none requires COOKIE_SECURE=true.");
}

const cookiePath = process.env.REFRESH_COOKIE_PATH || "/api/v1/auth";
if (!cookiePath.startsWith("/")) {
  fail("REFRESH_COOKIE_PATH must start with '/'.");
}

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

const brevoApiKey = readOptionalSecret("BREVO_API_KEY");
if (isProduction && !brevoApiKey) {
  fail(
    "BREVO_API_KEY is required in production: email verification and password reset cannot be delivered without it."
  );
}
if (brevoApiKey && !/^(xkeysib|xsmtpsib)-/.test(brevoApiKey)) {
  fail("BREVO_API_KEY must be a Brevo REST (xkeysib-) or SMTP (xsmtpsib-) key.");
}
const emailTransport = (process.env.EMAIL_TRANSPORT || "").toLowerCase();
if (emailTransport && !["api", "smtp"].includes(emailTransport)) {
  fail('EMAIL_TRANSPORT must be "api" or "smtp" when set.');
}
if (isProduction && emailTransport === "api" && !brevoApiKey.startsWith("xkeysib-")) {
  fail("EMAIL_TRANSPORT=api requires a Brevo REST key (xkeysib-).");
}
if (isProduction && emailTransport === "smtp" && !brevoApiKey.startsWith("xsmtpsib-")) {
  fail("EMAIL_TRANSPORT=smtp requires a Brevo SMTP key (xsmtpsib-).");
}

const enableHsts = readBoolean("ENABLE_HSTS", false);
if (enableHsts && !isProduction) {
  console.warn("[config] ENABLE_HSTS is set outside production; verify the deployment uses HTTPS.");
}

const trustProxy = readInteger("TRUST_PROXY", isProduction ? 1 : 0, { min: 0, max: 10 });

// Optional bearer token for the private /metrics endpoint. Prometheus runs on
// the backend network, but the token still protects against a shared network.
const metricsToken = readOptionalSecret("METRICS_TOKEN");

const mfaEncryptionKey = readOptionalSecret("MFA_ENCRYPTION_KEY");
if (mfaEncryptionKey && !/^[a-f0-9]{64}$/i.test(mfaEncryptionKey)) {
  fail("MFA_ENCRYPTION_KEY must be 64 hexadecimal characters.");
}
if (isProduction && !mfaEncryptionKey) {
  console.warn(
    "[config] MFA_ENCRYPTION_KEY is not set; MFA secrets use a key derived from JWT material. Set a dedicated key for independent rotation."
  );
}

const refreshTokenTtlMs = readNumber("REFRESH_TOKEN_TTL_MS", 7 * 24 * 60 * 60 * 1000);
const refreshTokenAbsoluteTtlMs = readNumber(
  "REFRESH_TOKEN_ABSOLUTE_TTL_MS",
  30 * 24 * 60 * 60 * 1000
);
if (refreshTokenAbsoluteTtlMs < refreshTokenTtlMs) {
  fail("REFRESH_TOKEN_ABSOLUTE_TTL_MS must be greater than or equal to REFRESH_TOKEN_TTL_MS.");
}

const env = Object.freeze({
  NODE_ENV: nodeEnv,
  IS_PRODUCTION: isProduction,
  PORT: readNumber("PORT", 5001),
  DATABASE_URL: readRequired("DATABASE_URL"),
  DB_ADAPTER: (() => {
    const adapter = (process.env.DB_ADAPTER || "pg").toLowerCase();
    if (!["pg", "neon"].includes(adapter)) {
      fail('Invalid DB_ADAPTER. Use "pg" (TCP) or "neon" (WebSocket).');
    }
    return adapter;
  })(),

  JWT_ALGORITHM: jwtAlgorithm,
  JWT_SECRET: jwtSecret,
  JWT_PRIVATE_KEY: jwtPrivateKey,
  JWT_PUBLIC_KEY: jwtPublicKey,
  JWT_KEY_ID: readOptional("JWT_KEY_ID"),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "15m",
  JWT_ISSUER: process.env.JWT_ISSUER || "auth-service",
  JWT_AUDIENCE: process.env.JWT_AUDIENCE || "banking-system",
  REFRESH_TOKEN_TTL_MS: refreshTokenTtlMs,
  REFRESH_TOKEN_ABSOLUTE_TTL_MS: refreshTokenAbsoluteTtlMs,
  REFRESH_TOKEN_GRACE_MS: readNumber("REFRESH_TOKEN_GRACE_MS", 30 * 1000),
  REFRESH_COOKIE_NAME: process.env.REFRESH_COOKIE_NAME || "meridian_refresh",
  REFRESH_COOKIE_PATH: cookiePath,
  REFRESH_COOKIE_SAME_SITE: cookieSameSite,
  COOKIE_SECURE: cookieSecure,

  INTERNAL_SERVICE_KEY: internalServiceKey,

  MFA_ENCRYPTION_KEY: mfaEncryptionKey,
  MFA_ISSUER: process.env.MFA_ISSUER || "Meridian Bank",
  MFA_CHALLENGE_TTL_MS: readNumber("MFA_CHALLENGE_TTL_MS", 5 * 60 * 1000),
  STEP_UP_TTL_MS: readNumber("STEP_UP_TTL_MS", 10 * 60 * 1000),

  CORS_ORIGINS: corsOrigins,
  TRUST_PROXY: trustProxy,
  METRICS_TOKEN: metricsToken,
  ENABLE_HSTS: enableHsts,

  BREVO_API_KEY: brevoApiKey,
  EMAIL_TRANSPORT: emailTransport,
  EMAIL_FROM: process.env.EMAIL_FROM || "Meridian Bank",
  EMAIL_FROM_EMAIL: process.env.EMAIL_FROM_EMAIL || "no-reply@meridianbank.example",
  EMAIL_SMTP_HOST: process.env.EMAIL_SMTP_HOST || "smtp-relay.brevo.com",
  EMAIL_SMTP_PORT: readNumber("EMAIL_SMTP_PORT", 587),
  EMAIL_SMTP_USER: process.env.EMAIL_SMTP_USER || process.env.EMAIL_FROM_EMAIL || "",

  BCRYPT_ROUNDS: readNumber("BCRYPT_ROUNDS", 12),
  LOG_LEVEL: process.env.LOG_LEVEL || "info",
  RATE_LIMIT_WINDOW_MS: readNumber("RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
  RATE_LIMIT_MAX: readNumber("RATE_LIMIT_MAX", 300),
  LOGIN_RATE_LIMIT_MAX: readNumber("LOGIN_RATE_LIMIT_MAX", 10),
  SENSITIVE_AUTH_RATE_LIMIT_MAX: readNumber("SENSITIVE_AUTH_RATE_LIMIT_MAX", 20),
  REFRESH_RATE_LIMIT_MAX: readNumber("REFRESH_RATE_LIMIT_MAX", 60),
  // Redis is optional: unset, every limiter counts this process alone.
  REDIS_URL: readOptional("REDIS_URL"),
  REDIS_KEY_PREFIX: readOptional("REDIS_KEY_PREFIX") || "auth",
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
});

module.exports = env;
