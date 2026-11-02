const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  "postgresql://test:test@localhost:5432/kyc_webhook_limit_test?schema=public";
process.env.JWT_SECRET = "kyc-webhook-limit-test-secret";
process.env.ENABLE_API_DOCS = "false";
process.env.DIDIT_API_BASE_URL = "https://verification.didit.me";
process.env.LOG_LEVEL = "silent";
process.env.WEBHOOK_RATE_LIMIT_MAX = "2";
process.env.RATE_LIMIT_MAX = "1000";

const app = require("../src/app");

const postWebhook = () =>
  request(app)
    .post("/api/v1/kyc/webhooks/didit")
    .set("Content-Type", "application/json")
    .send("{}");

test("webhook endpoint has a dedicated per-IP rate limit", async () => {
  const first = await postWebhook();
  const second = await postWebhook();
  const third = await postWebhook();

  assert.notEqual(first.status, 429);
  assert.notEqual(second.status, 429);
  assert.equal(third.status, 429);
  assert.equal(third.body.success, false);
  assert.ok(third.headers["retry-after"]);
  assert.match(third.headers["ratelimit-policy"], /^2;/);
});

test("the webhook budget does not throttle unrelated API calls", async () => {
  const health = await request(app).get("/api/v1/kyc/health");
  assert.equal(health.status, 200);
});
