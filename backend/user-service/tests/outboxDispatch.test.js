const testDatabaseUrl = process.env.WALLET_TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("WALLET_TEST_DATABASE_URL must point to an isolated test database");
}
const testDatabaseName = new URL(testDatabaseUrl).pathname.split("/").pop().split("?")[0];
if (!/_test$/i.test(testDatabaseName)) {
  throw new Error("Outbox dispatcher tests only run against a database whose name ends in _test");
}

process.env.DATABASE_URL = testDatabaseUrl;
process.env.NODE_ENV = "test";
process.env.OUTBOX_ENABLED = "true";
// Delivery is stubbed in every case; this URL only has to exist for the guard
// in startOutboxDispatcher, which these tests never call.
process.env.NOTIFICATION_SERVICE_URL = "http://127.0.0.1:9";
process.env.INTERNAL_SERVICE_KEY = "outbox-dispatch-test-key";
process.env.OUTBOX_BATCH_SIZE = "25";

const { randomUUID } = require("node:crypto");
const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/database");
const dispatcher = require("../src/modules/outbox/outbox.dispatcher");

const runId = randomUUID().replace(/-/g, "").slice(0, 10);
const aggregateId = `dispatch-${runId}`;
const eventIds = [];

const seed = async (count) => {
  const created = await Promise.all(
    Array.from({ length: count }, () =>
      prisma.outboxEvent.create({
        data: {
          type: "test.dispatch",
          aggregateType: "TestRun",
          aggregateId,
          payload: { runId },
          nextAttemptAt: new Date(Date.now() - 1000),
        },
      })
    )
  );
  eventIds.push(...created.map((event) => event.eventId));
  return created;
};

// Two API replicas run the same cycle. A row may only be handed to one of them,
// so the lease is asserted here by running back-to-back cycles: the second must
// not see what the first one is still holding.
const withStubbedDelivery = async (handler, outcome) => {
  const original = global.fetch;
  global.fetch = async (url, init) => {
    const eventId = JSON.parse(init.body).eventId;
    if (!eventIds.includes(eventId)) return original(url, init);
    handler(eventId);
    if (outcome === "fail") throw new Error("stub: connection refused");
    return { ok: true, status: 200 };
  };
  try {
    await dispatcher.processBatch();
    await dispatcher.processBatch();
  } finally {
    global.fetch = original;
  }
};

before(async () => {
  await prisma.$connect();
});

after(async () => {
  await prisma.outboxEvent.deleteMany({ where: { aggregateId } });
  await prisma.$disconnect();
});

test("a failed delivery is leased, so the next cycle does not retry it early", async () => {
  await seed(2);
  const attempted = [];
  await withStubbedDelivery((eventId) => attempted.push(eventId), "fail");

  assert.deepEqual(attempted.sort(), [...eventIds].sort());

  const rows = await prisma.outboxEvent.findMany({
    where: { eventId: { in: eventIds } },
    select: { attempts: true, publishedAt: true, nextAttemptAt: true },
  });
  assert.deepEqual(rows.map((row) => row.attempts).sort(), [1, 1]);
  assert.deepEqual(
    rows.map((row) => row.publishedAt),
    [null, null]
  );
  for (const row of rows) assert.ok(row.nextAttemptAt > new Date());
});

test("a delivered event is published once and never claimed again", async () => {
  const seeded = await seed(1);
  const delivered = [];
  await withStubbedDelivery((eventId) => delivered.push(eventId), "ok");

  assert.equal(delivered.length, 1);
  const published = await prisma.outboxEvent.findUnique({
    where: { id: seeded[0].id },
    select: { publishedAt: true, attempts: true },
  });
  assert.ok(published.publishedAt instanceof Date);
  assert.equal(published.attempts, 0);
});
