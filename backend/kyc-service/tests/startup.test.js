const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

process.env.DIDIT_API_BASE_URL = "https://verification.didit.me";
const app = require("../src/app");

test("GET / returns service metadata", async () => {
  const response = await request(app).get("/");

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.service, "kyc-service");
});

test("GET /api/v1/kyc/health returns healthy payload", async () => {
  const response = await request(app).get("/api/v1/kyc/health");

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.service, "kyc-service");
  assert.equal(response.body.data.status, "healthy");
});

test("unknown route returns a not found error envelope", async () => {
  const response = await request(app).get("/api/v1/kyc/unknown-route");

  assert.equal(response.status, 404);
  assert.equal(response.body.success, false);
  assert.ok(response.body.message);
});

test("submission endpoint requires an access token", async () => {
  const response = await request(app).post("/api/v1/kyc/submissions").send({});

  assert.equal(response.status, 401);
  assert.equal(response.body.success, false);
});
