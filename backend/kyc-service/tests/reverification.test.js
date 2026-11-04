// Re-verification is driven by database state (approval expiry, document
// expiry, tier review interval) and the partial unique index that keeps one
// task per reason, so this suite runs against the real kyc_test schema.
const testDatabaseUrl = process.env.KYC_TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("KYC re-verification tests need a test database URL");
}
const testDatabaseName = new URL(testDatabaseUrl).pathname.split("/").pop().split("?")[0];
if (!/_test$/i.test(testDatabaseName)) {
  throw new Error("KYC re-verification tests only run against a database whose name ends in _test");
}

process.env.DATABASE_URL = testDatabaseUrl;
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "kyc-reverification-test-secret";
process.env.JWT_ISSUER = "auth-service";
process.env.JWT_AUDIENCE = "banking-system";
process.env.ENABLE_API_DOCS = "false";
process.env.DIDIT_API_BASE_URL = "https://verification.didit.me";
process.env.STORAGE_ENCRYPTION_KEY = "17".repeat(32);
process.env.INTERNAL_SERVICE_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.KYC_APPROVAL_TTL_DAYS = "30";
process.env.RATE_LIMIT_MAX = "5000";
// The sweep is exercised directly; no reminder is delivered in this suite, so
// delivery stays off and the task must stay OPEN rather than pretend it was
// announced.
process.env.OUTBOX_ENABLED = "false";
process.env.KYC_REVERIFICATION_ENABLED = "false";

const { randomUUID } = require("node:crypto");
const after = require("node:test").after;
const testFn = require("node:test").test;
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const request = require("supertest");

const app = require("../src/app");
const prisma = require("../src/config/database");
const reVerificationService = require("../src/services/reVerificationService");

const runId = randomUUID().replace(/-/g, "").slice(0, 10);
const KYC = "/api/v1/kyc";
const DAY_MS = 24 * 60 * 60 * 1000;
const created = { submissionIds: [], userIds: [] };

const newUserId = () => {
  const id = randomUUID();
  created.userIds.push(id);
  return id;
};

const tokenFor = (sub, role) =>
  jwt.sign({ sub, typ: "access", role }, process.env.JWT_SECRET, {
    expiresIn: "5m",
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE,
  });

const MATCH_RESULTS = [
  { field: "firstName", status: "MATCH" },
  { field: "lastName", status: "MATCH" },
  { field: "dateOfBirth", status: "MATCH" },
];

const createSubmission = async (userId, overrides = {}) => {
  const submission = await prisma.kycSubmission.create({
    data: {
      userId,
      status: "APPROVED",
      documentType: "national_id",
      submittedAt: new Date(),
      reviewedAt: new Date(),
      approvedAt: new Date(),
      approvalExpiresAt: new Date(Date.now() + 300 * DAY_MS),
      tierId: "tier-def-sample-tier-1",
      providerStatus: "Approved",
      documentVerificationStatus: "Approved",
      dataComparisonStatus: "MATCH",
      faceMatchStatus: "Approved",
      livenessStatus: "Approved",
      comparisonResults: MATCH_RESULTS,
      ...overrides,
    },
  });
  created.submissionIds.push(submission.id);
  return submission;
};

const tasksFor = (userId) =>
  prisma.kycReVerificationTask.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });

after(async () => {
  await prisma.kycReVerificationTask.deleteMany({
    where: { userId: { in: created.userIds } },
  });
  await prisma.kycOutboxEvent.deleteMany({
    where: { aggregateType: "KYC_REVERIFICATION_TASK" },
  });
  await prisma.kycReview.deleteMany({ where: { submissionId: { in: created.submissionIds } } });
  await prisma.kycAuditEvent.deleteMany({
    where: { submissionId: { in: created.submissionIds } },
  });
  await prisma.kycDocument.deleteMany({ where: { submissionId: { in: created.submissionIds } } });
  await prisma.kycTierAssignment.deleteMany({ where: { userId: { in: created.userIds } } });
  await prisma.kycSubmission.deleteMany({ where: { id: { in: created.submissionIds } } });
  await prisma.$disconnect();
});

testFn("an approval inside the lead window opens one reminder that stays open", async () => {
  const userId = newUserId();
  const expiresAt = new Date(Date.now() + 10 * DAY_MS);
  await createSubmission(userId, { approvalExpiresAt: expiresAt });

  await reVerificationService.sweep();
  // A second cycle must not duplicate the request the officer already sees.
  await reVerificationService.sweep();

  const tasks = await tasksFor(userId);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].reason, "APPROVAL_EXPIRING");
  assert.equal(tasks[0].status, "OPEN");
  assert.equal(tasks[0].dueAt.getTime(), expiresAt.getTime());
  // Delivery is off in this suite, so nothing may claim the customer was told.
  assert.equal(tasks[0].notifiedAt, null);
});

testFn("an expired approval opens an overdue task without touching the approval", async () => {
  const userId = newUserId();
  const expiresAt = new Date(Date.now() - DAY_MS);
  const submission = await createSubmission(userId, { approvalExpiresAt: expiresAt });

  await reVerificationService.sweep();

  const [task] = await tasksFor(userId);
  assert.equal(task.reason, "APPROVAL_EXPIRED");
  assert.equal(task.status, "OVERDUE");

  const stored = await prisma.kycSubmission.findUnique({ where: { id: submission.id } });
  assert.equal(stored.status, "APPROVED");
  assert.equal(stored.approvalExpiresAt.getTime(), expiresAt.getTime());
});

testFn("a tier review interval schedules a periodic review of its own", async () => {
  const userId = newUserId();
  const approvedAt = new Date(Date.now() - 705 * DAY_MS);
  await createSubmission(userId, {
    approvedAt,
    reviewedAt: approvedAt,
    approvalExpiresAt: new Date(approvedAt.getTime() + 365 * DAY_MS),
  });

  await reVerificationService.sweep();

  const periodic = (await tasksFor(userId)).find((task) => task.reason === "PERIODIC_REVIEW");
  assert.ok(periodic);
  // TIER_1 asks for a review every 730 days; the due date follows the approval,
  // not the day the sweep happened to notice it.
  assert.equal(periodic.dueAt.getTime(), approvedAt.getTime() + 730 * DAY_MS);
  assert.equal(periodic.details.tierCode, "TIER_1");
});

testFn("the earliest expiring document drives the document reminder", async () => {
  const userId = newUserId();
  const submission = await createSubmission(userId);
  const documentExpiry = new Date(Date.now() + 5 * DAY_MS);
  await prisma.kycDocument.createMany({
    data: [
      {
        submissionId: submission.id,
        documentType: "national_id",
        storageKey: `reverification-tests/${runId}/id-front`,
        mimeType: "image/jpeg",
        fileName: "id-front.jpg",
        fileSizeBytes: 2048,
        expiresAt: new Date(Date.now() + 200 * DAY_MS),
      },
      {
        submissionId: submission.id,
        documentType: "passport",
        storageKey: `reverification-tests/${runId}/passport`,
        mimeType: "image/jpeg",
        fileName: "passport.jpg",
        fileSizeBytes: 2048,
        expiresAt: documentExpiry,
      },
    ],
  });

  await reVerificationService.sweep();

  const documentTask = (await tasksFor(userId)).find((task) => task.reason.startsWith("DOCUMENT_"));
  assert.ok(documentTask);
  assert.equal(documentTask.reason, "DOCUMENT_EXPIRING");
  assert.equal(documentTask.details.documentType, "passport");
  assert.equal(documentTask.dueAt.getTime(), documentExpiry.getTime());
});

testFn("a fresh approval closes the request it answers", async () => {
  const userId = newUserId();
  const oldSubmission = await createSubmission(userId, {
    status: "REJECTED",
    approvedAt: null,
    approvalExpiresAt: null,
  });
  await prisma.kycReVerificationTask.create({
    data: {
      userId,
      submissionId: oldSubmission.id,
      reason: "DOCUMENT_EXPIRING",
      status: "NOTIFIED",
      dueAt: new Date(Date.now() + 5 * DAY_MS),
      createdAt: new Date(Date.now() - 10 * DAY_MS),
    },
  });
  const freshSubmission = await createSubmission(userId);

  await reVerificationService.sweep();

  const tasks = await tasksFor(userId);
  const answered = tasks.find((task) => task.submissionId === oldSubmission.id);
  assert.equal(answered.status, "COMPLETED");
  assert.ok(answered.completedAt);
  // The fresh submission is still live, so it may have its own upcoming
  // reminders; what matters is that the answered one closed.
  assert.ok(freshSubmission.approvedAt);
});

testFn("an approval decision closes the customer's open requests", async () => {
  const userId = newUserId();
  const previous = await createSubmission(userId, {
    status: "REJECTED",
    approvedAt: null,
    approvalExpiresAt: null,
  });
  await prisma.kycReVerificationTask.create({
    data: {
      userId,
      submissionId: previous.id,
      reason: "APPROVAL_EXPIRED",
      status: "OVERDUE",
      dueAt: new Date(Date.now() - DAY_MS),
    },
  });

  const pending = await createSubmission(userId, {
    status: "PENDING_REVIEW",
    approvedAt: null,
    reviewedAt: null,
    approvalExpiresAt: null,
  });
  await prisma.kycDocument.create({
    data: {
      submissionId: pending.id,
      documentType: "national_id",
      storageKey: `reverification-tests/${runId}/pending-id`,
      mimeType: "image/jpeg",
      fileName: "pending-id.jpg",
      fileSizeBytes: 2048,
      status: "OCR_COMPLETE",
    },
  });

  const response = await request(app)
    .post(`${KYC}/officer/submissions/${pending.id}/decision`)
    .set("Authorization", `Bearer ${tokenFor(randomUUID(), "VERIFICATION_OFFICER")}`)
    .send({ decision: "APPROVE", reason: "Document, face and liveness checks all passed." });

  assert.equal(response.status, 200);
  const [task] = await tasksFor(userId);
  assert.equal(task.status, "COMPLETED");
});

testFn("customers see only their own tasks and only officers see the queue", async () => {
  const userId = newUserId();
  const otherUserId = newUserId();
  const submission = await createSubmission(userId);
  await prisma.kycReVerificationTask.create({
    data: {
      userId,
      submissionId: submission.id,
      reason: "PERIODIC_REVIEW",
      status: "OPEN",
      dueAt: new Date(Date.now() + DAY_MS),
    },
  });
  await prisma.kycReVerificationTask.create({
    data: {
      userId: otherUserId,
      reason: "PERIODIC_REVIEW",
      status: "OPEN",
      dueAt: new Date(Date.now() + DAY_MS),
    },
  });

  const mine = await request(app)
    .get(`${KYC}/reverification/tasks`)
    .set("Authorization", `Bearer ${tokenFor(userId, "USER")}`);
  assert.equal(mine.status, 200);
  assert.equal(mine.body.data.tasks.length, 1);
  assert.equal(mine.body.data.tasks[0].userId, userId);

  const forbidden = await request(app)
    .get(`${KYC}/officer/reverification/tasks`)
    .set("Authorization", `Bearer ${tokenFor(userId, "USER")}`);
  assert.equal(forbidden.status, 403);

  const officerQueue = await request(app)
    .get(`${KYC}/officer/reverification/tasks?reason=PERIODIC_REVIEW&overdueOnly=false`)
    .set("Authorization", `Bearer ${tokenFor(randomUUID(), "VERIFICATION_OFFICER")}`);
  assert.equal(officerQueue.status, 200);
  assert.ok(officerQueue.body.data.tasks.some((task) => task.userId === otherUserId));

  const stats = await request(app)
    .get(`${KYC}/officer/reverification/stats`)
    .set("Authorization", `Bearer ${tokenFor(randomUUID(), "ADMIN")}`);
  assert.equal(stats.status, 200);
  assert.equal(typeof stats.body.data.overdue, "number");
});

testFn("an officer can waive an open request once, and the waiver is recorded", async () => {
  const userId = newUserId();
  const task = await prisma.kycReVerificationTask.create({
    data: {
      userId,
      reason: "DOCUMENT_EXPIRED",
      status: "OPEN",
      dueAt: new Date(Date.now() - DAY_MS),
    },
  });
  const officerToken = tokenFor(randomUUID(), "VERIFICATION_OFFICER");

  const waived = await request(app)
    .post(`${KYC}/officer/reverification/tasks/${task.id}/waive`)
    .set("Authorization", `Bearer ${officerToken}`)
    .send({ reason: "Customer presented a valid document at a branch." });
  assert.equal(waived.status, 200);
  assert.equal(waived.body.data.task.status, "WAIVED");
  assert.equal(
    waived.body.data.task.waiverReason,
    "Customer presented a valid document at a branch."
  );

  const again = await request(app)
    .post(`${KYC}/officer/reverification/tasks/${task.id}/waive`)
    .set("Authorization", `Bearer ${officerToken}`)
    .send({ reason: "Second attempt on a decided request." });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "TASK_NOT_OPEN");
});

testFn("the task routes reject ids and filters they cannot honour", async () => {
  const officerToken = tokenFor(randomUUID(), "VERIFICATION_OFFICER");

  const badId = await request(app)
    .post(`${KYC}/officer/reverification/tasks/not-a-uuid/waive`)
    .set("Authorization", `Bearer ${officerToken}`)
    .send({ reason: "Invalid id must be rejected before it reaches the database." });
  assert.equal(badId.status, 400);

  const badReason = await request(app)
    .get(`${KYC}/officer/reverification/tasks?reason=NOT_A_REASON`)
    .set("Authorization", `Bearer ${officerToken}`);
  assert.equal(badReason.status, 400);

  const missing = await request(app)
    .post(`${KYC}/officer/reverification/tasks/${randomUUID()}/waive`)
    .set("Authorization", `Bearer ${officerToken}`)
    .send({ reason: "No such task exists." });
  assert.equal(missing.status, 404);
});
