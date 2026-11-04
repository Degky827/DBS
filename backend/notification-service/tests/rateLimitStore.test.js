// Distributed rate limiting needs Redis, so the shared-counter tests skip
// without it; the fallback tests run everywhere because they use a client that
// deliberately fails.
const REDIS_URL = process.env.REDIS_URL || "";
process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  "postgresql://test:test@localhost:5432/notification_rate_limit_test?schema=public";
process.env.AUTH_MODE = "dev";
process.env.DEV_API_KEY = "";
process.env.JWT_SECRET = "test-secret-0123456789abcdef";
process.env.INTERNAL_SERVICE_KEY = "test-internal-key-0123456789abcdef";
process.env.RATE_LIMIT_MAX = "1000";
process.env.AUTH_RATE_LIMIT_MAX = "1000";
process.env.WEBHOOK_RATE_LIMIT_MAX = "1000";
process.env.LOG_LEVEL = "silent";
if (REDIS_URL) process.env.REDIS_URL = REDIS_URL;

const { randomUUID } = require("node:crypto");
const { once } = require("node:events");
const { after, test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { rateLimit } = require("express-rate-limit");

const env = require("../src/config/env");
const redis = require("../src/config/redis");
const {
  createRateLimitStore,
  createFallbackStore,
  withTimeout,
} = require("../src/middlewares/rateLimitStore");

const runPrefix = `${env.REDIS_KEY_PREFIX}:ratelimit:test:${randomUUID()}:`;

// An open Redis socket holds the process alive after the last assertion, which
// is what redis.shutdown() in server.js does in production.
after(async () => {
  await redis.shutdown();
});

const ping = (client) => client.sendCommand(["PING"]);

// The client connects in the background and a request never waits for it, so a
// test of the shared path has to wait for the handshake itself.
const readyClient = async () => {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const client = redis.getReadyClient();
    if (client) return client;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
};

// One limiter per replica, because express-rate-limit refuses a store shared by
// two limiters - the replicas are separate processes in production.
const startReplica = async (store) => {
  const app = express();
  app.get(
    "/probe",
    rateLimit({
      windowMs: 60_000,
      limit: 2,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      ipv6Subnet: 56,
      store,
    }),
    (req, res) => res.json({ ok: true })
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/probe`;
  return {
    hit: async () => (await fetch(url)).status,
    close: async () => {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
};

test(
  "two replicas share one counter when Redis holds the window",
  { skip: !REDIS_URL && "REDIS_URL is not set" },
  async () => {
    const client = await readyClient();
    assert.ok(client, "the configured Redis did not become ready");
    assert.equal(await ping(client), "PONG");

    const limiterOptions = { windowMs: 60_000, limit: 10 };
    const open = (name, keyPrefix) => {
      const store = createRateLimitStore(name, { keyPrefix });
      store.init(limiterOptions);
      return store;
    };
    const key = "client:1";

    const first = open("first", `${runPrefix}first:`);
    const second = open("second", `${runPrefix}second:`);
    // Two limiters with their own prefixes must not read each other's window,
    // or the shared result below would just be two limiters colliding on a key.
    assert.equal((await first.increment(key)).totalHits, 1);
    assert.equal((await second.increment(key)).totalHits, 1);
    assert.equal((await first.increment(key)).totalHits, 2);

    // Two stores with one prefix are the two replicas of the same limiter.
    const pairPrefix = `${runPrefix}both:`;
    const shared = open("both-a", pairPrefix);
    const otherReplica = open("both-b", pairPrefix);
    assert.equal((await shared.increment(key)).totalHits, 1);
    assert.equal((await otherReplica.increment(key)).totalHits, 2);
    assert.equal((await otherReplica.get(key)).totalHits, 2);
    // localKeys is how express-rate-limit knows another replica cannot see
    // these counts; after a Redis-backed count it must be false.
    assert.equal(shared.localKeys, false);

    // The window must actually live in Redis: a silent fallback to process-local
    // counters would leave the assertions above true and the cluster unprotected.
    const scan = await client.sendCommand(["SCAN", "0", "MATCH", `${runPrefix}*`, "COUNT", "100"]);
    assert.ok(scan[1].length > 0, "no rate limit key was written to Redis");

    // The same sharing across two separate HTTP apps, which is what a pair of
    // API replicas does: requests to both spend one budget of two.
    const a = await startReplica(shared);
    const b = await startReplica(otherReplica);
    try {
      assert.equal(await a.hit(), 200);
      assert.equal(await b.hit(), 200);
      assert.equal(await a.hit(), 429, "the second replica did not see the shared window");
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
  }
);

test("rate limiting keeps counting per process when Redis stops answering", async () => {
  const failing = {
    sendCommand: async () => {
      throw new Error("redis is down");
    },
  };
  const store = createFallbackStore({
    clientFactory: () => failing,
    keyPrefix: `${runPrefix}fallback:`,
    timeoutMs: 200,
  });
  const replica = await startReplica(store);
  try {
    const statuses = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      statuses.push(await replica.hit());
    }
    // An unreachable Redis must not become unlimited traffic and not a 500
    // either: the hit is counted locally and the limit still binds.
    assert.deepEqual(statuses, [200, 200, 429, 429, 429]);
  } finally {
    await replica.close();
  }
});

test("a store that never answers is abandoned inside the timeout", async () => {
  const started = Date.now();
  await assert.rejects(
    withTimeout(() => new Promise(() => {}), 60),
    /did not answer in 60ms/
  );
  assert.ok(Date.now() - started < 2000, "the timeout never fired");
});

test("a store with no Redis reports its keys as process-local", async () => {
  const store = createFallbackStore({
    clientFactory: () => null,
    keyPrefix: `${runPrefix}local:`,
  });
  assert.equal(store.localKeys, true);
  assert.equal((await store.increment("client:1")).totalHits, 1);
  assert.equal((await store.increment("client:1")).totalHits, 2);
});
