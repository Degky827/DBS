// The KYC status cache only exists when Redis does, so the whole spec skips
// without REDIS_URL. Requiring src/config/env happens inside the tests because
// kycClient reads KYC_SERVICE_URL when the module loads, and that URL is only
// known once the stub kyc-service below is listening.
const REDIS_URL = process.env.REDIS_URL || "";
process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  "postgresql://test:test@localhost:5432/user_kyc_cache_test?schema=public";
process.env.AUTH_MODE = "dev";
process.env.DEV_API_KEY = "";
process.env.JWT_SECRET = "test-secret-0123456789abcdef";
process.env.INTERNAL_SERVICE_KEY = "test-internal-key-0123456789abcdef";
process.env.RATE_LIMIT_MAX = "10000";
process.env.LOG_LEVEL = "silent";
if (REDIS_URL) process.env.REDIS_URL = REDIS_URL;

const { randomUUID } = require("node:crypto");
const { once } = require("node:events");
const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const skip = REDIS_URL ? false : "REDIS_URL is not set";

let server = null;
let hits = 0;
let current = null;
let kycClient = null;
let redis = null;

const statusPayload = (overrides = {}) => ({
  isApproved: true,
  status: "APPROVED",
  tierCode: "TIER_1",
  tierId: "tier-1",
  tierVersion: 2,
  tierSource: "ASSIGNMENT",
  allowedOperations: ["DEPOSIT", "TRANSFER"],
  limits: [
    {
      operation: "TRANSFER",
      currency: "ETB",
      minAmount: "1.00",
      maxAmount: "25000.00",
      dailyAmount: "5000.00",
      dailyCount: 20,
      monthlyAmount: null,
      maxBalance: null,
      isAllowed: true,
    },
  ],
  ...overrides,
});

before(async () => {
  if (!REDIS_URL) return;
  const app = express();
  app.get("/internal/users/:userId/status", (req, res) => {
    hits += 1;
    res.json({ success: true, data: current(req.params.userId) });
  });
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  process.env.KYC_SERVICE_URL = `http://127.0.0.1:${server.address().port}`;
  kycClient = require("../src/services/kycClient");
  redis = require("../src/config/redis");
  const deadline = Date.now() + 5000;
  while (!redis.isReady() && Date.now() < deadline) {
    redis.getReadyClient();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(redis.isReady(), "the configured Redis did not become ready");
});

after(async () => {
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  if (redis) await redis.shutdown();
});

test("a money-path KYC read is served from Redis for the configured window", { skip }, async () => {
  hits = 0;
  const userId = `cache-${randomUUID()}`;
  current = () => statusPayload();

  const first = await kycClient.getUserKycStatus(userId);
  assert.equal(hits, 1);
  assert.equal(first.tier.limits[0].maxAmount, "25000.00");

  const second = await kycClient.getUserKycStatus(userId);
  assert.equal(hits, 1, "the second read should have come from the cache");
  assert.deepEqual(second, first);

  // An officer raising the tier must not be invisible forever: the cached
  // answer is what the previous read said, and it expires on its own.
  current = () => statusPayload({ tierCode: "TIER_2" });
  const third = await kycClient.getUserKycStatus(userId);
  assert.equal(third.tier.code, "TIER_1");
  assert.equal(hits, 1);
});

test("one customer's cached tier is never handed to another", { skip }, async () => {
  hits = 0;
  const alice = `alice-${randomUUID()}`;
  const bob = `bob-${randomUUID()}`;
  current = (userId) => statusPayload({ tierCode: userId === alice ? "TIER_1" : "TIER_3" });

  assert.equal((await kycClient.getUserKycStatus(alice)).tier.code, "TIER_1");
  assert.equal((await kycClient.getUserKycStatus(bob)).tier.code, "TIER_3");
  assert.equal(hits, 2);
});

test("an approval that has already expired is never cached", { skip }, async () => {
  hits = 0;
  const userId = `expired-${randomUUID()}`;
  current = () => statusPayload({ approvalExpiresAt: new Date(Date.now() - 1000).toISOString() });

  await kycClient.getUserKycStatus(userId);
  await kycClient.getUserKycStatus(userId);
  assert.equal(hits, 2, "an expiring status has to be re-read every time");
});

test("a cached approval does not outlive its own expiry", { skip }, async () => {
  hits = 0;
  const userId = `soon-${randomUUID()}`;
  // Slightly over a second away, so the cached entry is dropped with the
  // expiry rather than at the full configured window.
  current = () => statusPayload({ approvalExpiresAt: new Date(Date.now() + 1400).toISOString() });

  await kycClient.getUserKycStatus(userId);
  await kycClient.getUserKycStatus(userId);
  assert.equal(hits, 1, "the read inside the window should be cached");

  await new Promise((resolve) => setTimeout(resolve, 1600));
  await kycClient.getUserKycStatus(userId);
  assert.equal(hits, 2, "the entry should have expired with the approval");
});

test("an unavailable kyc-service is a failure, never a stale success", { skip }, async () => {
  hits = 0;
  const userId = `down-${randomUUID()}`;
  current = () => statusPayload();
  await kycClient.getUserKycStatus(userId);
  assert.equal(hits, 1);

  server.close();
  await once(server, "close");
  await assert.rejects(
    () => kycClient.getUserKycStatus(`other-${randomUUID()}`),
    (error) => error.name === "KycUnavailableError"
  );
});
