const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  "postgresql://test:test@localhost:5432/user_security_test?schema=public";
process.env.AUTH_MODE = "dev";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.ENABLE_API_DOCS = "false";
process.env.LOG_LEVEL = "silent";

const databasePath = require.resolve("../src/config/database");
require.cache[databasePath] = {
  id: databasePath,
  filename: databasePath,
  loaded: true,
  exports: {
    $queryRaw: async () => [{ "?column?": 1 }],
    $disconnect: async () => {},
  },
};

const app = require("../src/app");

const TRUSTED_ORIGIN = "http://localhost:5173";

test("user API responses carry locked-down headers and no server banner", async () => {
  const response = await request(app).get("/api/v1/health");

  assert.equal(response.status, 200);
  assert.match(response.headers["content-security-policy"], /default-src 'none'/);
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
  assert.equal(response.headers["x-frame-options"], "DENY");
  assert.equal(response.headers["strict-transport-security"], undefined);
  assert.equal(response.headers["x-powered-by"], undefined);
});

test("user CORS allows only configured origins and never enables credentials", async () => {
  const allowed = await request(app)
    .get("/api/v1/health")
    .set("Origin", TRUSTED_ORIGIN);
  assert.equal(allowed.headers["access-control-allow-origin"], TRUSTED_ORIGIN);
  assert.equal(allowed.headers["access-control-allow-credentials"], undefined);

  const rejected = await request(app)
    .get("/api/v1/health")
    .set("Origin", "http://evil.example");
  assert.equal(rejected.headers["access-control-allow-origin"], undefined);
});

test("Swagger is not served when documentation is disabled", async () => {
  const response = await request(app).get("/api/v1/docs/");

  assert.equal(response.status, 404);
  assert.doesNotMatch(response.text, /swagger/i);
});

test("liveness does not query the database and readiness does", async () => {
  const health = await request(app).get("/api/v1/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.data.status, "healthy");

  const ready = await request(app).get("/api/v1/ready");
  assert.equal(ready.status, 200);
  assert.equal(ready.body.data.status, "ready");
});

test("wallet and profile routes reject unauthenticated requests", async () => {
  const wallets = await request(app).get("/api/v1/wallets/me");
  assert.equal(wallets.status, 401);
  assert.equal(wallets.body.success, false);

  const profile = await request(app).get("/api/v1/users/me");
  assert.equal(profile.status, 401);
});
