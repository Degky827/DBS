process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.NOTIFICATION_TEST_DATABASE_URL ||
  "postgresql://auth:auth@localhost:5432/notification_test?schema=public";
process.env.JWT_SECRET = "test-only-jwt-secret-0123456789abcdef0123456789";
process.env.INTERNAL_SERVICE_KEY = "test-only-internal-key-0123456789abcdef0123456789";
process.env.EMAIL_ENABLED = "false";
process.env.EMAIL_FROM_EMAIL = "no-reply@example.test";
process.env.LOG_LEVEL = "silent";

const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const jwt = require("jsonwebtoken");
const request = require("supertest");

const app = require("../src/app");
const prisma = require("../src/config/database");

const INTERNAL_KEY = process.env.INTERNAL_SERVICE_KEY;

const tokenFor = (email) =>
  jwt.sign({ sub: randomUUID(), email, role: "USER", typ: "access" }, process.env.JWT_SECRET, {
    algorithm: "HS256",
    issuer: "auth-service",
    audience: "banking-system",
    expiresIn: "5m",
  });

const transferEvent = (eventId = randomUUID()) => ({
  eventId,
  type: "transfer.completed",
  aggregateType: "transaction",
  aggregateId: randomUUID(),
  occurredAt: new Date().toISOString(),
  payload: {
    transactionReference: "tx_ref_1",
    amount: "250.00",
    feeAmount: "2.50",
    currency: "ETB",
    sender: { userId: randomUUID(), email: "sender@example.test", name: "Sender" },
    recipient: {
      userId: randomUUID(),
      email: "recipient@example.test",
      name: "Recipient",
    },
  },
});

const postEvent = (body, key = INTERNAL_KEY) =>
  request(app)
    .post("/api/v1/internal/notifications/events")
    .set("X-Internal-Service-Key", key)
    .send(body);

test.beforeEach(async () => {
  await prisma.notification.deleteMany();
  await prisma.processedEvent.deleteMany();
});

test.after(async () => {
  await prisma.notification.deleteMany();
  await prisma.processedEvent.deleteMany();
  await prisma.$disconnect();
});

test("internal event endpoint rejects a missing or wrong service key", async () => {
  const missing = await request(app)
    .post("/api/v1/internal/notifications/events")
    .send(transferEvent());
  assert.equal(missing.status, 401);

  const wrong = await postEvent(transferEvent(), "wrong-key");
  assert.equal(wrong.status, 401);
});

test("transfer events fan out to sender and recipient inboxes", async () => {
  const body = transferEvent();
  const response = await postEvent(body);
  assert.equal(response.status, 202);
  assert.equal(response.body.data.notificationsCreated, 2);
  assert.equal(response.body.data.ignored, false);

  const senderList = await request(app)
    .get("/api/v1/notifications")
    .set("Authorization", `Bearer ${tokenFor("sender@example.test")}`);
  assert.equal(senderList.status, 200);
  assert.equal(senderList.body.data.notifications.length, 1);
  assert.equal(senderList.body.data.notifications[0].title, "Transfer sent");

  const recipientList = await request(app)
    .get("/api/v1/notifications")
    .set("Authorization", `Bearer ${tokenFor("RECIPIENT@example.test")}`);
  assert.equal(recipientList.body.data.notifications.length, 1);
  assert.equal(recipientList.body.data.notifications[0].title, "Transfer received");
});

test("redelivered events return 409 and do not duplicate notifications", async () => {
  const body = transferEvent();
  assert.equal((await postEvent(body)).status, 202);
  assert.equal((await postEvent(body)).status, 409);

  const count = await prisma.notification.count();
  assert.equal(count, 2);
});

test("unknown event types are acknowledged without notifications", async () => {
  const response = await postEvent({
    eventId: randomUUID(),
    type: "unmapped.event",
    payload: {},
  });
  assert.equal(response.status, 202);
  assert.equal(response.body.data.ignored, true);
  assert.equal(await prisma.notification.count(), 0);
});

// The event type crosses a service boundary. A name that exists on
// Object.prototype must resolve to nothing, not to an inherited function.
for (const inherited of ["constructor", "__proto__", "toString"]) {
  test(`inherited property names are not dispatched as templates: ${inherited}`, async () => {
    const response = await postEvent({
      eventId: randomUUID(),
      type: inherited,
      payload: { user: { email: "someone@example.test" } },
    });
    assert.equal(response.status, 202);
    assert.equal(response.body.data.ignored, true);
    assert.equal(await prisma.notification.count(), 0);
  });
}

test("notification reads are scoped to the token email", async () => {
  await postEvent(transferEvent());

  const senderToken = tokenFor("sender@example.test");
  const otherToken = tokenFor("someone-else@example.test");

  const unread = await request(app)
    .get("/api/v1/notifications/unread-count")
    .set("Authorization", `Bearer ${senderToken}`);
  assert.equal(unread.body.data.unreadCount, 1);

  const otherList = await request(app)
    .get("/api/v1/notifications")
    .set("Authorization", `Bearer ${otherToken}`);
  assert.equal(otherList.body.data.notifications.length, 0);

  const list = await request(app)
    .get("/api/v1/notifications?unreadOnly=true")
    .set("Authorization", `Bearer ${senderToken}`);
  const notificationId = list.body.data.notifications[0].id;

  const forbidden = await request(app)
    .post(`/api/v1/notifications/${notificationId}/read`)
    .set("Authorization", `Bearer ${otherToken}`);
  assert.equal(forbidden.status, 404);

  const marked = await request(app)
    .post(`/api/v1/notifications/${notificationId}/read`)
    .set("Authorization", `Bearer ${senderToken}`);
  assert.equal(marked.status, 200);
  assert.ok(marked.body.data.notification.readAt);

  const replayed = await request(app)
    .post(`/api/v1/notifications/${notificationId}/read`)
    .set("Authorization", `Bearer ${senderToken}`);
  assert.equal(replayed.body.data.replayed, true);

  const readAll = await request(app)
    .post("/api/v1/notifications/read-all")
    .set("Authorization", `Bearer ${senderToken}`);
  assert.equal(readAll.status, 200);

  const empty = await request(app)
    .get("/api/v1/notifications?unreadOnly=true")
    .set("Authorization", `Bearer ${senderToken}`);
  assert.equal(empty.body.data.notifications.length, 0);
});

test("email queue is skipped when email delivery is disabled", async () => {
  await postEvent(transferEvent());
  const statuses = await prisma.notification.findMany({
    select: { emailStatus: true },
  });
  assert.ok(statuses.every((row) => row.emailStatus === "SKIPPED"));
});

test("list query rejects an unknown cursor", async () => {
  const response = await request(app)
    .get(`/api/v1/notifications?cursor=${randomUUID()}`)
    .set("Authorization", `Bearer ${tokenFor("sender@example.test")}`);
  assert.equal(response.status, 400);
});

test("health and readiness probes respond", async () => {
  const health = await request(app).get("/api/v1/health");
  assert.equal(health.status, 200);
  const ready = await request(app).get("/api/v1/ready");
  assert.equal(ready.status, 200);
});
