const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  "postgresql://test:test@localhost:5432/kyc_security_test?schema=public";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.INTERNAL_SERVICE_KEY = "kyc-test-internal-key-0123456789abcdef";
process.env.ENABLE_API_DOCS = "false";
process.env.DIDIT_API_BASE_URL = "https://verification.didit.me";
process.env.LOG_LEVEL = "silent";

const submissionServicePath = require.resolve("../src/services/submissionService");
require.cache[submissionServicePath] = {
  id: submissionServicePath,
  filename: submissionServicePath,
  loaded: true,
  exports: {
    getInternalStatus: async () => ({ status: "NO_SUBMISSION", isApproved: false }),
  },
};

const app = require("../src/app");

const TRUSTED_ORIGIN = "http://localhost:5173";
const INTERNAL_KEY = process.env.INTERNAL_SERVICE_KEY;
const USER_ID = "6f1c2a4e-2b7d-4c1a-9f3e-8a5b6c7d8e9f";

test("KYC API responses carry locked-down headers and no server banner", async () => {
  const response = await request(app).get("/api/v1/kyc/health");

  assert.equal(response.status, 200);
  assert.match(response.headers["content-security-policy"], /default-src 'none'/);
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
  assert.equal(response.headers["x-frame-options"], "DENY");
  assert.equal(response.headers["strict-transport-security"], undefined);
  assert.equal(response.headers["x-powered-by"], undefined);
});

test("KYC CORS allows only configured origins and never enables credentials", async () => {
  const allowed = await request(app)
    .get("/api/v1/kyc/health")
    .set("Origin", TRUSTED_ORIGIN);
  assert.equal(allowed.headers["access-control-allow-origin"], TRUSTED_ORIGIN);
  assert.equal(allowed.headers["access-control-allow-credentials"], undefined);

  const rejected = await request(app)
    .get("/api/v1/kyc/health")
    .set("Origin", "http://evil.example");
  assert.equal(rejected.headers["access-control-allow-origin"], undefined);
});

test("Swagger is not served when documentation is disabled", async () => {
  const response = await request(app).get("/api/v1/kyc/docs/");

  assert.equal(response.status, 404);
  assert.doesNotMatch(response.text, /swagger/i);
});

test("internal endpoints reject missing or incorrect service keys", async () => {
  const missing = await request(app).get(
    `/api/v1/kyc/internal/users/${USER_ID}/status`
  );
  assert.equal(missing.status, 401);
  assert.equal(missing.body.code, "INVALID_INTERNAL_KEY");
  assert.equal(missing.body.success, false);
  assert.doesNotMatch(missing.text, new RegExp(INTERNAL_KEY));

  const wrong = await request(app)
    .get(`/api/v1/kyc/internal/users/${USER_ID}/status`)
    .set("X-Internal-Service-Key", "wrong-key");
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.code, "INVALID_INTERNAL_KEY");

  const accepted = await request(app)
    .get(`/api/v1/kyc/internal/users/${USER_ID}/status`)
    .set("X-Internal-Service-Key", INTERNAL_KEY);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.data.status, "NO_SUBMISSION");
});

test("customer and officer routes require a bearer access token", async () => {
  const submissions = await request(app)
    .post("/api/v1/kyc/submissions")
    .send({});
  assert.equal(submissions.status, 401);

  const officer = await request(app).get("/api/v1/kyc/officer/reviews");
  assert.equal(officer.status, 401);
});
