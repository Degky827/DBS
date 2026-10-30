const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");

process.env.NODE_ENV = "production";
process.env.DATABASE_URL =
  "postgresql://user:password@localhost:5432/auth_docs_test?schema=public";
process.env.JWT_SECRET =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.INTERNAL_SERVICE_KEY =
  "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
process.env.CORS_ORIGIN = "https://bank.example.com";
process.env.COOKIE_SECURE = "true";
process.env.ENABLE_HSTS = "true";
process.env.ENABLE_API_DOCS = "true";
process.env.API_DOCS_USERNAME = "docs-reviewer";
process.env.API_DOCS_PASSWORD = "docs-password-0123456789";
process.env.TRUST_PROXY = "1";
process.env.BCRYPT_ROUNDS = "4";
process.env.LOG_LEVEL = "silent";
process.env.RATE_LIMIT_MAX = "1000";
process.env.LOGIN_RATE_LIMIT_MAX = "100";
process.env.BREVO_API_KEY = "xkeysib-test-key";

const fakePrisma = {
  $queryRaw: async () => [{ "?column?": 1 }],
};

const databasePath = require.resolve("../src/config/database");
require.cache[databasePath] = {
  id: databasePath,
  filename: databasePath,
  loaded: true,
  exports: fakePrisma,
};

const app = require("../src/app");

let server;
let baseUrl;

test.before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
});

const request = (path, headers = {}) => fetch(`${baseUrl}${path}`, { headers });

test("enabled docs do not apply the relaxed Swagger CSP to API routes", async () => {
  const response = await request("/api/v1/health");
  const csp = response.headers.get("content-security-policy") || "";

  assert.equal(response.status, 200);
  assert.match(csp, /default-src 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline/);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
});

test("enabled docs do not require Basic credentials on API routes", async () => {
  const health = await request("/api/v1/ready");
  assert.equal(health.status, 200);

  const root = await request("/");
  assert.equal(root.status, 200);
});

test("documentation itself remains protected and uses the scoped policy", async () => {
  const unauthorized = await request("/api/v1/openapi.json");
  assert.equal(unauthorized.status, 401);
  assert.match(
    unauthorized.headers.get("www-authenticate") || "",
    /Basic/i
  );

  const credentials = Buffer.from(
    `${process.env.API_DOCS_USERNAME}:${process.env.API_DOCS_PASSWORD}`
  ).toString("base64");
  const authorized = await request("/api/v1/openapi.json", {
    Authorization: `Basic ${credentials}`,
  });
  const csp = authorized.headers.get("content-security-policy") || "";

  assert.equal(authorized.status, 200);
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /unsafe-inline/);
});
