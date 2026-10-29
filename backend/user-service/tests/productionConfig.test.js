const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const serviceRoot = path.resolve(__dirname, "..");

const STRONG_SECRET =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const STRONG_INTERNAL_KEY =
  "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

const baseEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://user:password@localhost:5432/user_db?schema=public",
  AUTH_MODE: "jwt",
  JWT_ALGORITHM: "HS256",
  JWT_SECRET: STRONG_SECRET,
  JWT_ISSUER: "auth-service",
  JWT_AUDIENCE: "banking-system",
  AUTH_SERVICE_URL: "https://auth.example.com/api/v1",
  KYC_SERVICE_URL: "https://kyc.example.com/api/v1/kyc",
  INTERNAL_SERVICE_KEY: STRONG_INTERNAL_KEY,
  CORS_ORIGIN: "https://bank.example.com",
  ENABLE_API_DOCS: "false",
  ENABLE_HSTS: "true",
  API_DOCS_USERNAME: "",
  API_DOCS_PASSWORD: "",
  CHAPA_SECRET_KEY: "",
  CHAPA_WEBHOOK_SECRET: "",
  CHAPA_CALLBACK_URL: "",
  CHAPA_RETURN_URL: "",
  AVATAR_UPLOAD_DIR: "",
  JWT_PUBLIC_KEY: "",
};

const loadEnv = (overrides = {}) => {
  const env = { ...process.env, ...baseEnv, ...overrides };
  for (const [key, value] of Object.entries(env)) {
    if (value === null) delete env[key];
  }
  return spawnSync(process.execPath, ["-e", "require('./src/config/env')"], {
    cwd: serviceRoot,
    env,
    encoding: "utf8",
  });
};

const assertStartupFails = (overrides, expected) => {
  const result = loadEnv(overrides);
  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.match(result.stderr, expected);
};

test("a strong production configuration loads", () => {
  const result = loadEnv();
  assert.equal(result.status, 0, result.stderr);
});

test("development authentication cannot run in production", () => {
  assertStartupFails({ AUTH_MODE: "dev" }, /AUTH_MODE=dev is not allowed/);
});

test("production rejects missing or weak JWT and internal secrets", () => {
  assertStartupFails({ JWT_SECRET: "" }, /JWT_SECRET/);
  assertStartupFails(
    { JWT_SECRET: "cccccccccccccccccccccccccccccccc" },
    /JWT_SECRET/
  );
  assertStartupFails({ INTERNAL_SERVICE_KEY: "" }, /INTERNAL_SERVICE_KEY/);
});

test("production rejects wildcard and plaintext CORS origins", () => {
  assertStartupFails({ CORS_ORIGIN: "*" }, /wildcard/i);
  assertStartupFails(
    { CORS_ORIGIN: "http://bank.example.com" },
    /HTTPS in production/i
  );
});

test("production requires credentials when documentation is enabled", () => {
  assertStartupFails(
    { ENABLE_API_DOCS: "true" },
    /API_DOCS_USERNAME and a strong API_DOCS_PASSWORD/
  );

  const result = loadEnv({
    ENABLE_API_DOCS: "true",
    API_DOCS_USERNAME: "docs-user",
    API_DOCS_PASSWORD: "DocsPassword-0123456789",
  });
  assert.equal(result.status, 0, result.stderr);
});
