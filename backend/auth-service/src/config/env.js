const path = require("path");
const crypto = require("crypto");

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

const jwtSecret = readOptional("JWT_SECRET");
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

const internalServiceKey = readOptional("INTERNAL_SERVICE_KEY");
if (isProduction && !isStrongSecret(internalServiceKey)) {
  fail("INTERNAL_SERVICE_KEY must be at least 32 characters of high-entropy data in production.");
}

const corsOrigins = parseOrigins(process.env.CORS_ORIGIN, { production: isProduction });

const cookieSecure = readBoolean("COOKIE_SECURE", isProduction);
if (isProduction && !cookieSecure && !readBoolean("ALLOW_INSECURE_COOKIES", false)) {
  fail("COOKIE_SECURE must be true in production (set ALLOW_INSECURE_COOKIES=true only for isolated HTTP testing).");
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
const apiDocsPassword = readOptional("API_DOCS_PASSWORD");
if (isProduction && enableApiDocs) {
  if (!apiDocsUsername || !isStrongSecret(apiDocsPassword, 16)) {
    fail(
      "API documentation in production requires API_DOCS_USERNAME and a strong API_DOCS_PASSWORD (16+ characters)."
    );
  }
}

const brevoApiKey = readOptional("BREVO_API_KEY");
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
if (
  isProduction &&
  emailTransport === "api" &&
  !brevoApiKey.startsWith("xkeysib-")
) {
  fail("EMAIL_TRANSPORT=api requires a Brevo REST key (xkeysib-).");
}
if (
  isProduction &&
  emailTransport === "smtp" &&
  !brevoApiKey.startsWith("xsmtpsib-")
) {
  fail("EMAIL_TRANSPORT=smtp requires a Brevo SMTP key (xsmtpsib-).");
}

const enableHsts = readBoolean("ENABLE_HSTS", false);
if (enableHsts && !isProduction) {
  console.warn("[config] ENABLE_HSTS is set outside production; verify the deployment uses HTTPS.");
}

const trustProxy = readInteger("TRUST_PROXY", isProduction ? 1 : 0, { min: 0, max: 10 });

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
  REFRESH_TOKEN_TTL_MS: readNumber("REFRESH_TOKEN_TTL_MS", 7 * 24 * 60 * 60 * 1000),
  REFRESH_TOKEN_GRACE_MS: readNumber("REFRESH_TOKEN_GRACE_MS", 30 * 1000),
  REFRESH_COOKIE_NAME: process.env.REFRESH_COOKIE_NAME || "meridian_refresh",
  REFRESH_COOKIE_PATH: cookiePath,
  REFRESH_COOKIE_SAME_SITE: cookieSameSite,
  COOKIE_SECURE: cookieSecure,

  INTERNAL_SERVICE_KEY: internalServiceKey,

  CORS_ORIGINS: corsOrigins,
  TRUST_PROXY: trustProxy,
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
  ENABLE_API_DOCS: enableApiDocs,
  API_DOCS_USERNAME: apiDocsUsername,
  API_DOCS_PASSWORD: apiDocsPassword,
});

module.exports = env;
