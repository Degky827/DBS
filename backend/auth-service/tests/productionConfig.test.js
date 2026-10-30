const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const serviceRoot = path.resolve(__dirname, "..");

const STRONG_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const STRONG_INTERNAL_KEY =
  "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

const baseEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://user:password@localhost:5432/auth_db?schema=public",
  JWT_ALGORITHM: "HS256",
  JWT_SECRET: STRONG_SECRET,
  JWT_EXPIRES_IN: "15m",
  JWT_ISSUER: "auth-service",
  JWT_AUDIENCE: "banking-system",
  CORS_ORIGIN: "https://bank.example.com",
  COOKIE_SECURE: "true",
  INTERNAL_SERVICE_KEY: STRONG_INTERNAL_KEY,
  ENABLE_API_DOCS: "false",
  ENABLE_HSTS: "true",
  BCRYPT_ROUNDS: "12",
  BREVO_API_KEY: "xkeysib-test-key",
  API_DOCS_USERNAME: "",
  API_DOCS_PASSWORD: "",
  ALLOW_INSECURE_COOKIES: "",
  JWT_PRIVATE_KEY: "",
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

test("production rejects a missing or weak JWT secret", () => {
  assertStartupFails({ JWT_SECRET: "" }, /JWT_SECRET/);
  assertStartupFails(
    { JWT_SECRET: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    /JWT_SECRET/
  );
});

test("production rejects a missing or weak internal service key", () => {
  assertStartupFails({ INTERNAL_SERVICE_KEY: "" }, /INTERNAL_SERVICE_KEY/);
  assertStartupFails(
    { INTERNAL_SERVICE_KEY: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    /INTERNAL_SERVICE_KEY/
  );
});

test("production rejects wildcard and plaintext CORS origins", () => {
  assertStartupFails({ CORS_ORIGIN: "*" }, /wildcard/i);
  assertStartupFails(
    { CORS_ORIGIN: "http://bank.example.com" },
    /HTTPS in production/i
  );
  assertStartupFails(
    { CORS_ORIGIN: "https://bank.example.com/app" },
    /bare http\(s\) origins/i
  );
});

test("production requires secure cookies", () => {
  assertStartupFails({ COOKIE_SECURE: "false" }, /COOKIE_SECURE/);
});

test("production requires a Brevo key so verification email can be delivered", () => {
  assertStartupFails({ BREVO_API_KEY: "" }, /BREVO_API_KEY is required/);
  assertStartupFails({ BREVO_API_KEY: "not-a-brevo-key" }, /BREVO_API_KEY/);
  assertStartupFails(
    { BREVO_API_KEY: "xsmtpsib-test-key", EMAIL_TRANSPORT: "api" },
    /EMAIL_TRANSPORT=api/
  );
});

test("production requires documentation credentials when docs are enabled", () => {
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

test("RS256 production configuration does not require an HS256 secret", () => {
  const { generateKeyPairSync } = require("node:crypto");
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const result = loadEnv({
    JWT_ALGORITHM: "RS256",
    JWT_SECRET: "",
    JWT_PRIVATE_KEY: privateKey,
    JWT_PUBLIC_KEY: publicKey,
  });
  assert.equal(result.status, 0, result.stderr);
});

test("RS256 production configuration requires a valid public key", () => {
  const { generateKeyPairSync } = require("node:crypto");
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  assertStartupFails(
    {
      JWT_ALGORITHM: "RS256",
      JWT_SECRET: "",
      JWT_PRIVATE_KEY: privateKey,
      JWT_PUBLIC_KEY: "",
    },
    /JWT_PUBLIC_KEY/
  );

  assertStartupFails(
    {
      JWT_ALGORITHM: "RS256",
      JWT_SECRET: "",
      JWT_PRIVATE_KEY: privateKey,
      JWT_PUBLIC_KEY: "not-a-pem-key",
    },
    /JWT_PUBLIC_KEY/
  );
});
