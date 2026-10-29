const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const serviceRoot = path.resolve(__dirname, "..");

const STRONG_SECRET =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const STRONG_INTERNAL_KEY =
  "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
const STORAGE_KEY =
  "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

const baseEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://user:password@localhost:5432/kyc_db?schema=public",
  JWT_ALGORITHM: "HS256",
  JWT_SECRET: STRONG_SECRET,
  JWT_ISSUER: "auth-service",
  JWT_AUDIENCE: "banking-system",
  INTERNAL_SERVICE_KEY: STRONG_INTERNAL_KEY,
  USER_SERVICE_URL: "https://user.example.com/api/v1",
  AUTH_SERVICE_URL: "https://auth.example.com/api/v1",
  CORS_ORIGIN: "https://bank.example.com",
  STORAGE_ENCRYPTION_KEY: STORAGE_KEY,
  DIDIT_API_BASE_URL: "https://verification.didit.me",
  ENABLE_API_DOCS: "false",
  ENABLE_HSTS: "true",
  API_DOCS_USERNAME: "",
  API_DOCS_PASSWORD: "",
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

test("production rejects missing or weak JWT and internal secrets", () => {
  assertStartupFails({ JWT_SECRET: "" }, /JWT_SECRET/);
  assertStartupFails(
    { JWT_SECRET: "dddddddddddddddddddddddddddddddd" },
    /JWT_SECRET/
  );
  assertStartupFails({ INTERNAL_SERVICE_KEY: "" }, /INTERNAL_SERVICE_KEY/);
});

test("production requires a 64-character document encryption key", () => {
  assertStartupFails({ STORAGE_ENCRYPTION_KEY: "" }, /STORAGE_ENCRYPTION_KEY/);
  assertStartupFails(
    { STORAGE_ENCRYPTION_KEY: "not-a-valid-key" },
    /64 hexadecimal/
  );
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
