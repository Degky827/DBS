process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  "postgresql://test:test@localhost:5432/kyc_docs_test?schema=public";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.INTERNAL_SERVICE_KEY = "kyc-test-internal-key-0123456789abcdef";
process.env.ENABLE_API_DOCS = "true";
process.env.DIDIT_API_BASE_URL = "https://verification.didit.me";
process.env.LOG_LEVEL = "silent";

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../src/app");

test("KYC OpenAPI document exposes every route as a top-level path", async () => {
  const response = await request(app).get("/api/v1/kyc/openapi.json");
  assert.equal(response.status, 200);

  const { paths } = response.body;
  assert.ok(paths["/submissions/{submissionId}/verification-session"].post);
  assert.ok(paths["/submissions/{submissionId}/compare"].post);
  assert.ok(paths["/officer/reviews"].get);
  assert.ok(paths["/officer/submissions/{submissionId}/decision"].post);
});
