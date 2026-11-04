// The reminder path crosses two service boundaries (contact lookup and outbox),
// so this suite keeps the real database but stubs the HTTP call and enables the
// outbox, which is what decides whether a task may claim the customer was told.
const testDatabaseUrl = process.env.KYC_TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("KYC re-verification reminder tests need a test database URL");
}
const testDatabaseName = new URL(testDatabaseUrl).pathname.split("/").pop().split("?")[0];
if (!/_test$/i.test(testDatabaseName)) {
  throw new Error("KYC tests only run against a database whose name ends in _test");
}

process.env.DATABASE_URL = testDatabaseUrl;
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "kyc-reverification-reminder-secret";
process.env.JWT_ISSUER = "auth-service";
process.env.JWT_AUDIENCE = "banking-system";
process.env.ENABLE_API_DOCS = "false";
process.env.DIDIT_API_BASE_URL = "https://verification.didit.me";
process.env.STORAGE_ENCRYPTION_KEY = "17".repeat(32);
process.env.INTERNAL_SERVICE_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.OUTBOX_ENABLED = "true";
process.env.NOTIFICATION_SERVICE_URL = "https://notification.test/api/v1";
process.env.USER_SERVICE_URL = "https://user.test/api/v1";
process.env.KYC_APPROVAL_TTL_DAYS = "30";
process.env.RATE_LIMIT_MAX = "5000";
process.env.KYC_REVERIFICATION_ENABLED = "false";

const { randomUUID } = require("node:crypto");
const after = require("node:test").after;
const testFn = require("node:test").test;
const assert = require("node:assert/strict");

const prisma = require("../src/config/database");
const reVerificationService = require("../src/services/reVerificationService");

const DAY_MS = 24 * 60 * 60 * 1000;
const created = { submissionIds: [], userIds: [] };

const originalFetch = global.fetch;

const newUserId = () => {
  const id = randomUUID();
  created.userIds.push(id);
  return id;
};

const createApprovedSubmission = async (userId, expiresInDays) => {
  const submission = await prisma.kycSubmission.create({
    data: {
      userId,
      status: "APPROVED",
      documentType: "national_id",
      submittedAt: new Date(),
      reviewedAt: new Date(),
      approvedAt: new Date(),
      approvalExpiresAt: new Date(Date.now() + expiresInDays * DAY_MS),
      tierId: "tier-def-sample-tier-1",
    },
  });
  created.submissionIds.push(submission.id);
  return submission;
};

after(async () => {
  global.fetch = originalFetch;
  const tasks = await prisma.kycReVerificationTask.findMany({
    where: { userId: { in: created.userIds } },
    select: { id: true },
  });
  await prisma.kycOutboxEvent.deleteMany({
    where: { eventId: { in: tasks.map((task) => task.id) } },
  });
  await prisma.kycReVerificationTask.deleteMany({
    where: { userId: { in: created.userIds } },
  });
  await prisma.kycSubmission.deleteMany({ where: { id: { in: created.submissionIds } } });
  await prisma.$disconnect();
});

testFn("a delivered reminder marks the task notified with a stable event id", async () => {
  const userId = newUserId();
  await createApprovedSubmission(userId, 3);
  const calls = [];

  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          contact: {
            userId,
            email: "due-soon@example.test",
            name: "Due Soon",
            accountStatus: "ACTIVE",
          },
        },
      }),
    };
  };

  await reVerificationService.sweep();
  await reVerificationService.sweep();

  const [task] = await prisma.kycReVerificationTask.findMany({ where: { userId } });
  assert.equal(task.status, "NOTIFIED");
  assert.ok(task.notifiedAt);

  const events = await prisma.kycOutboxEvent.findMany({ where: { eventId: task.id } });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "kyc.reverification.due");
  assert.equal(events[0].aggregateId, task.id);
  assert.equal(events[0].payload.user.email, "due-soon@example.test");

  // The second sweep found the existing task and did not ask the customer again.
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/internal\/users\/.+\/contact$/);
  assert.equal(
    calls[0].options.headers["X-Internal-Service-Key"],
    process.env.INTERNAL_SERVICE_KEY
  );
});

testFn("a failed contact lookup leaves the task open instead of claiming delivery", async () => {
  const userId = newUserId();
  await createApprovedSubmission(userId, 3);

  global.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });

  await reVerificationService.sweep();

  const [task] = await prisma.kycReVerificationTask.findMany({ where: { userId } });
  assert.equal(task.status, "OPEN");
  assert.equal(task.notifiedAt, null);
  assert.equal(await prisma.kycOutboxEvent.count({ where: { eventId: task.id } }), 0);
});
