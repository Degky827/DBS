// Tier behaviour is decided by database-backed policy (CHECK constraints,
// partial unique indexes, DECIMAL limits), so this suite runs against the real
// kyc_test schema instead of a stubbed client.
const testDatabaseUrl = process.env.KYC_TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("KYC tier tests need a test database URL");
}
const testDatabaseName = new URL(testDatabaseUrl).pathname.split("/").pop().split("?")[0];
if (!/_test$/i.test(testDatabaseName)) {
  throw new Error("KYC tier tests only run against a database whose name ends in _test");
}

process.env.DATABASE_URL = testDatabaseUrl;
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "kyc-tier-test-secret";
process.env.JWT_ISSUER = "auth-service";
process.env.JWT_AUDIENCE = "banking-system";
process.env.ENABLE_API_DOCS = "false";
process.env.DIDIT_API_BASE_URL = "https://verification.didit.me";
process.env.STORAGE_ENCRYPTION_KEY = "17".repeat(32);
process.env.INTERNAL_SERVICE_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
// Deliberately different from every seeded approvalValidDays so a test can tell
// which value the approval actually used.
process.env.KYC_APPROVAL_TTL_DAYS = "30";
process.env.RATE_LIMIT_MAX = "5000";

const { randomUUID } = require("node:crypto");
const after = require("node:test").after;
const testFn = require("node:test").test;
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const request = require("supertest");

const app = require("../src/app");
const prisma = require("../src/config/database");

const runId = randomUUID().replace(/-/g, "").slice(0, 10);
const KYC = "/api/v1/kyc";
const MATCH_RESULTS = [
  { field: "firstName", status: "MATCH" },
  { field: "lastName", status: "MATCH" },
  { field: "dateOfBirth", status: "MATCH" },
];

const created = {
  submissionIds: [],
  userIds: [],
  tierDefinitionIds: [],
  outboxEventIds: [],
};

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

const approvedFields = (overrides = {}) => ({
  providerStatus: "Approved",
  documentVerificationStatus: "Approved",
  dataComparisonStatus: "MATCH",
  faceMatchStatus: "Approved",
  livenessStatus: "Approved",
  comparisonResults: MATCH_RESULTS,
  ...overrides,
});

const createSubmission = async (userId, documentTypes, overrides = {}) => {
  const submission = await prisma.kycSubmission.create({
    data: {
      userId,
      status: "PENDING_REVIEW",
      documentType: documentTypes[0],
      submittedAt: new Date(),
      ...approvedFields(overrides.submission),
    },
  });
  created.submissionIds.push(submission.id);

  for (const documentType of documentTypes) {
    await prisma.kycDocument.create({
      data: {
        submissionId: submission.id,
        documentType,
        storageKey: `tier-tests/${runId}/${randomUUID()}`,
        mimeType: "image/jpeg",
        fileName: `${documentType}.jpg`,
        fileSizeBytes: 20480,
        status: "OCR_COMPLETE",
        ...overrides.document,
      },
    });
  }

  return submission;
};

const definitions = {};
const assignmentFor = (userId) =>
  prisma.kycTierAssignment.findFirst({
    where: { userId, status: "APPROVED" },
    orderBy: { decidedAt: "desc" },
    include: { tier: true },
  });

const decide = (submissionId, customerToken, body) =>
  request(app)
    .post(`${KYC}/officer/submissions/${submissionId}/decision`)
    .set("Authorization", `Bearer ${customerToken}`)
    .send(body);

after(async () => {
  await prisma.kycOutboxEvent.deleteMany({
    where: { id: { in: created.outboxEventIds } },
  });
  await prisma.kycReVerificationTask.deleteMany({
    where: { userId: { in: created.userIds } },
  });
  await prisma.kycTierAssignment.deleteMany({
    where: { userId: { in: created.userIds } },
  });
  await prisma.kycAuditEvent.deleteMany({
    where: { submissionId: { in: created.submissionIds } },
  });
  await prisma.kycReview.deleteMany({
    where: { submissionId: { in: created.submissionIds } },
  });
  await prisma.kycSubmission.deleteMany({
    where: { id: { in: created.submissionIds } },
  });
  await prisma.kycTierLimit.deleteMany({
    where: { tierId: { in: created.tierDefinitionIds } },
  });
  await prisma.kycTierDefinition.deleteMany({
    where: { id: { in: created.tierDefinitionIds } },
  });
  await prisma.$disconnect();
});

testFn("tier definitions expose policy, with money kept as decimal strings", async () => {
  const response = await request(app)
    .get(`${KYC}/tiers`)
    .set("Authorization", `Bearer ${tokenFor(newUserId(), "USER")}`);

  assert.equal(response.status, 200);
  const byCode = Object.fromEntries(
    response.body.data.definitions.map((tier) => [tier.code, tier])
  );
  assert.deepEqual(Object.keys(byCode).sort(), ["TIER_1", "TIER_2", "TIER_3"]);
  assert.equal(byCode.TIER_1.allowedOperations.includes("PAYOUT"), false);
  assert.equal(byCode.TIER_3.limits.length, 5);

  // A float here would silently round a limit; the API must hand on the exact
  // DECIMAL(19,2) text.
  const payout = byCode.TIER_2.limits.find((row) => row.operation === "PAYOUT");
  assert.equal(typeof payout.maxAmount, "string");
  assert.match(payout.maxAmount, /^\d+(\.\d{2})?$/);

  Object.assign(definitions, byCode);
});

testFn("qualification reports what the stored evidence can and cannot prove", async () => {
  const userId = newUserId();
  const submission = await createSubmission(userId, ["national_id"]);

  const response = await request(app)
    .get(`${KYC}/officer/submissions/${submission.id}/qualification`)
    .set("Authorization", `Bearer ${tokenFor(randomUUID(), "VERIFICATION_OFFICER")}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.suggested.code, "TIER_1");
  assert.equal(response.body.data.evidence.documentCount, 1);
  assert.deepEqual(response.body.data.evidence.verifiedFields, [
    "firstName",
    "lastName",
    "dateOfBirth",
  ]);

  const candidates = Object.fromEntries(
    response.body.data.candidates.map((row) => [row.code, row])
  );
  assert.equal(candidates.TIER_1.qualifies, true);
  assert.equal(candidates.TIER_2.qualifies, false);
  assert.deepEqual(
    candidates.TIER_2.blockers.map((row) => row.code),
    ["INSUFFICIENT_DOCUMENTS"]
  );
  assert.equal(
    candidates.TIER_3.blockers.some((row) => row.code === "MISSING_DOCUMENT_TYPE"),
    true
  );
});

testFn("approval assigns the suggested tier and the tier owns the validity window", async () => {
  const userId = newUserId();
  const submission = await createSubmission(userId, ["national_id"]);
  const officerToken = tokenFor(randomUUID(), "VERIFICATION_OFFICER");

  const response = await decide(submission.id, officerToken, {
    decision: "APPROVE",
    reason: "Document, face and liveness checks all passed.",
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.status, "APPROVED");
  assert.equal(response.body.data.tier.code, "TIER_1");

  const approvedAt = new Date(response.body.data.approvedAt);
  const expiresAt = new Date(response.body.data.approvalExpiresAt);
  // 365 days is the tier's approvalValidDays; the service default is 30.
  assert.equal(Math.round((expiresAt - approvedAt) / (24 * 60 * 60 * 1000)), 365);

  const held = await assignmentFor(userId);
  assert.ok(held, "an approved assignment row is written");
  assert.equal(held.tier.code, "TIER_1");
  assert.equal(held.direction, "INITIAL");
  assert.equal(held.submissionId, submission.id);
  assert.equal(held.expiresAt.getTime(), expiresAt.getTime());
});

testFn("status endpoints carry the held tier and its limits", async () => {
  const holder = newUserId();
  const submission = await createSubmission(holder, ["national_id"]);
  await decide(submission.id, tokenFor(randomUUID(), "VERIFICATION_OFFICER"), {
    decision: "APPROVE",
    reason: "Evidence satisfied every configured check.",
  });

  const current = await request(app)
    .get(`${KYC}/tiers/current`)
    .set("Authorization", `Bearer ${tokenFor(holder, "USER")}`);

  assert.equal(current.status, 200);
  assert.equal(current.body.data.tier.code, "TIER_1");
  assert.equal(current.body.data.source, "ASSIGNMENT");
  assert.equal(
    current.body.data.limits.find((row) => row.operation === "WITHDRAWAL").isAllowed,
    false
  );

  const internal = await request(app)
    .get(`${KYC}/internal/users/${holder}/status`)
    .set("X-Internal-Service-Key", process.env.INTERNAL_SERVICE_KEY);

  // user-service reads isApproved unchanged; the tier payload is additive.
  assert.equal(internal.status, 200);
  assert.equal(internal.body.data.isApproved, true);
  assert.equal(internal.body.data.tierCode, "TIER_1");
  assert.deepEqual(internal.body.data.allowedOperations, ["DEPOSIT", "TRANSFER"]);
  assert.equal(typeof internal.body.data.limits[0].maxAmount, "string");
});

testFn("an explicit tier the evidence cannot support is refused without deciding", async () => {
  const userId = newUserId();
  const submission = await createSubmission(userId, ["national_id"]);

  const response = await decide(submission.id, tokenFor(randomUUID(), "VERIFICATION_OFFICER"), {
    decision: "APPROVE",
    reason: "Attempting to grant the advanced tier early.",
    tierId: definitions.TIER_3.id,
  });

  assert.equal(response.status, 409);
  assert.equal(response.body.code, "TIER_EVIDENCE_INSUFFICIENT");
  assert.equal(
    response.body.errors.blockers.some((row) => row.code === "MISSING_DOCUMENT_TYPE"),
    true
  );

  const unchanged = await prisma.kycSubmission.findUnique({
    where: { id: submission.id },
    select: { status: true, tierId: true },
  });
  assert.equal(unchanged.status, "PENDING_REVIEW");
  assert.equal(unchanged.tierId, null);
});

testFn("an officer may name a tier the evidence does support", async () => {
  const userId = newUserId();
  const submission = await createSubmission(userId, ["national_id", "national_id"]);

  const response = await decide(submission.id, tokenFor(randomUUID(), "VERIFICATION_OFFICER"), {
    decision: "APPROVE",
    reason: "Two captures with liveness match the intermediate tier.",
    tierId: definitions.TIER_2.id,
  });

  assert.equal(response.status, 200);
  const held = await assignmentFor(userId);
  assert.equal(held.tier.code, "TIER_2");
});

testFn("a later approval supersedes the held tier and records the direction", async () => {
  const userId = newUserId();
  const first = await createSubmission(userId, ["national_id"]);
  const officerToken = tokenFor(randomUUID(), "VERIFICATION_OFFICER");

  await decide(first.id, officerToken, {
    decision: "APPROVE",
    reason: "Basic tier evidence is complete.",
  });

  // A resubmission is the only way to reach the reviewable state again.
  await prisma.kycSubmission.update({
    where: { id: first.id },
    data: { status: "NEEDS_RESUBMISSION" },
  });
  const second = await createSubmission(userId, ["national_id", "national_id"]);

  const response = await decide(second.id, officerToken, {
    decision: "APPROVE",
    reason: "Two captures plus liveness clear the intermediate tier.",
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.tier.code, "TIER_2");

  const rows = await prisma.kycTierAssignment.findMany({
    where: { userId },
    include: { tier: true },
    orderBy: { requestedAt: "asc" },
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].status, "SUPERSEDED");
  assert.equal(rows[1].status, "APPROVED");
  assert.equal(rows[1].direction, "UPGRADE");
  assert.ok(rows[1].decisionReason, "the grant keeps its reason");
});

testFn("a verified customer can ask for a higher tier and an officer can grant it", async () => {
  const userId = newUserId();
  const customerToken = tokenFor(userId, "USER");
  const submission = await createSubmission(userId, ["national_id", "national_id"]);

  // The evidence here would support TIER_2, but the officer holds the customer
  // at TIER_1. Raising that ceiling is what a customer request is for.
  await decide(submission.id, tokenFor(randomUUID(), "VERIFICATION_OFFICER"), {
    decision: "APPROVE",
    reason: "Approved, held at the basic tier pending a limits review.",
    tierId: definitions.TIER_1.id,
  });

  const request_ = await request(app)
    .post(`${KYC}/tiers/requests`)
    .set("Authorization", `Bearer ${customerToken}`)
    .send({ tierCode: "TIER_2", reason: "Need higher transfer limits for rent." });

  assert.equal(request_.status, 201);
  assert.equal(request_.body.data.request.status, "REQUESTED");
  assert.equal(request_.body.data.evaluation.qualifies, true);

  const duplicate = await request(app)
    .post(`${KYC}/tiers/requests`)
    .set("Authorization", `Bearer ${customerToken}`)
    .send({ tierCode: "TIER_1", reason: "Try a second concurrent request." });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, "TIER_REQUEST_ALREADY_OPEN");

  const queue = await request(app)
    .get(`${KYC}/officer/tier-requests`)
    .set("Authorization", `Bearer ${tokenFor(randomUUID(), "VERIFICATION_OFFICER")}`);
  assert.equal(queue.status, 200);
  const listed = queue.body.data.requests.find((row) => row.id === request_.body.data.request.id);
  assert.ok(listed, "the queue lists the pending request with its tier");
  assert.equal(listed.tier.code, "TIER_2");

  const decided = await request(app)
    .post(`${KYC}/officer/tier-requests/${request_.body.data.request.id}/decision`)
    .set("Authorization", `Bearer ${tokenFor(randomUUID(), "VERIFICATION_OFFICER")}`)
    .send({ decision: "APPROVE", decisionReason: "Two captures on file; the ceiling can rise." });

  assert.equal(decided.status, 200);
  assert.equal(decided.body.data.direction, "UPGRADE");
  assert.equal(decided.body.data.status, "APPROVED");

  const heldRows = await prisma.kycTierAssignment.findMany({
    where: { userId, status: "APPROVED" },
  });
  assert.equal(heldRows.length, 1, "the request became the grant instead of duplicating it");

  const current = await request(app)
    .get(`${KYC}/tiers/current`)
    .set("Authorization", `Bearer ${customerToken}`);
  assert.equal(current.body.data.tier.code, "TIER_2");
  assert.equal(current.body.data.openRequest, null);
});

testFn("an unverified customer cannot request a tier", async () => {
  const userId = newUserId();
  await createSubmission(userId, ["national_id"]);

  const response = await request(app)
    .post(`${KYC}/tiers/requests`)
    .set("Authorization", `Bearer ${tokenFor(userId, "USER")}`)
    .send({ tierCode: "TIER_2", reason: "Asking before anyone has checked." });

  assert.equal(response.status, 409);
  assert.equal(response.body.code, "KYC_NOT_APPROVED");

  const rows = await prisma.kycTierAssignment.findMany({ where: { userId } });
  assert.equal(rows.length, 0);
});

testFn("a rejected request leaves the held tier untouched", async () => {
  const userId = newUserId();
  const customerToken = tokenFor(userId, "USER");
  const submission = await createSubmission(userId, ["national_id", "national_id"]);
  await decide(submission.id, tokenFor(randomUUID(), "VERIFICATION_OFFICER"), {
    decision: "APPROVE",
    reason: "Evidence satisfied every configured check.",
  });

  const created_ = await request(app)
    .post(`${KYC}/tiers/requests`)
    .set("Authorization", `Bearer ${customerToken}`)
    .send({ tierCode: "TIER_3", reason: "Requesting the advanced tier." });
  assert.equal(created_.status, 201);

  const rejected = await request(app)
    .post(`${KYC}/officer/tier-requests/${created_.body.data.request.id}/decision`)
    .set("Authorization", `Bearer ${tokenFor(randomUUID(), "VERIFICATION_OFFICER")}`)
    .send({
      decision: "REJECT",
      decisionReason: "The passport capture the advanced tier needs is not on file.",
    });

  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.data.status, "REJECTED");
  assert.equal(
    rejected.body.data.decisionReason,
    "The passport capture the advanced tier needs is not on file."
  );

  const current = await request(app)
    .get(`${KYC}/tiers/current`)
    .set("Authorization", `Bearer ${customerToken}`);
  assert.equal(current.body.data.isApproved, true);
  assert.equal(current.body.data.tier.code, "TIER_2");
  assert.equal(current.body.data.openRequest, null);
});

testFn("a request the stored evidence cannot support is refused a grant", async () => {
  const userId = newUserId();
  const customerToken = tokenFor(userId, "USER");
  const submission = await createSubmission(userId, ["national_id", "national_id"]);
  await decide(submission.id, tokenFor(randomUUID(), "VERIFICATION_OFFICER"), {
    decision: "APPROVE",
    reason: "Evidence satisfied every configured check.",
  });

  const created_ = await request(app)
    .post(`${KYC}/tiers/requests`)
    .set("Authorization", `Bearer ${customerToken}`)
    .send({ tierCode: "TIER_3", reason: "Requesting the advanced tier." });
  assert.equal(created_.status, 201);

  const grant = await request(app)
    .post(`${KYC}/officer/tier-requests/${created_.body.data.request.id}/decision`)
    .set("Authorization", `Bearer ${tokenFor(randomUUID(), "VERIFICATION_OFFICER")}`)
    .send({ decision: "APPROVE", decisionReason: "Wanted to accept the request as asked." });

  assert.equal(grant.status, 409);
  assert.equal(grant.body.code, "TIER_EVIDENCE_INSUFFICIENT");
  assert.equal(
    grant.body.errors.blockers.some((row) => row.code === "MISSING_DOCUMENT_TYPE"),
    true
  );

  // The refusal is not a decision: an officer can still reject it explicitly.
  const still = await prisma.kycTierAssignment.findUnique({
    where: { id: created_.body.data.request.id },
    select: { status: true },
  });
  assert.equal(still.status, "REQUESTED");
});

testFn("nobody can decide their own tier request", async () => {
  const userId = newUserId();
  const customerToken = tokenFor(userId, "USER");
  const submission = await createSubmission(userId, ["national_id", "national_id"]);
  await decide(submission.id, tokenFor(randomUUID(), "VERIFICATION_OFFICER"), {
    decision: "APPROVE",
    reason: "Evidence satisfied every configured check.",
  });

  const created_ = await request(app)
    .post(`${KYC}/tiers/requests`)
    .set("Authorization", `Bearer ${customerToken}`)
    .send({ tierCode: "TIER_3", reason: "Requesting the advanced tier." });
  assert.equal(created_.status, 201);

  const selfDecision = await request(app)
    .post(`${KYC}/officer/tier-requests/${created_.body.data.request.id}/decision`)
    // The same subject, now carrying an officer role.
    .set("Authorization", `Bearer ${tokenFor(userId, "VERIFICATION_OFFICER")}`)
    .send({ decision: "APPROVE", decisionReason: "Self-approved, obviously." });

  assert.equal(selfDecision.status, 403);
  assert.equal(selfDecision.body.code, "SELF_REVIEW_FORBIDDEN");
});

testFn("revoking an approval cancels the tier grant", async () => {
  const userId = newUserId();
  const submission = await createSubmission(userId, ["national_id"]);
  const officerToken = tokenFor(randomUUID(), "VERIFICATION_OFFICER");

  await decide(submission.id, officerToken, {
    decision: "APPROVE",
    reason: "Basic tier evidence is complete.",
  });

  const revoked = await request(app)
    .post(`${KYC}/officer/submissions/${submission.id}/revoke`)
    .set("Authorization", `Bearer ${officerToken}`)
    .send({ reason: "The identity document was reported fraudulent." });
  assert.equal(revoked.status, 200);

  const rows = await prisma.kycTierAssignment.findMany({ where: { userId } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "CANCELLED");
  assert.match(rows[0].decisionReason, /reported fraudulent/);

  const current = await request(app)
    .get(`${KYC}/tiers/current`)
    .set("Authorization", `Bearer ${tokenFor(userId, "USER")}`);
  assert.equal(current.body.data.isApproved, false);
  assert.equal(current.body.data.tier, null);
});

testFn("an approval predating tiers falls back to the lowest active tier", async () => {
  const userId = newUserId();
  const legacy = await prisma.kycSubmission.create({
    data: {
      userId,
      status: "APPROVED",
      approvedAt: new Date(),
      approvalExpiresAt: new Date(Date.now() + 86400000),
      ...approvedFields(),
    },
  });
  created.submissionIds.push(legacy.id);

  const response = await request(app)
    .get(`${KYC}/tiers/current`)
    .set("Authorization", `Bearer ${tokenFor(userId, "USER")}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.isApproved, true);
  // No grant row and no tier on the submission: the conservative reading is the
  // lowest tier that exists, never an unlimited one.
  assert.equal(response.body.data.source, "FALLBACK");
  assert.equal(response.body.data.tier.code, "TIER_1");
});

testFn("only an administrator can change tier policy", async () => {
  const officerResponse = await request(app)
    .get(`${KYC}/admin/tiers`)
    .set("Authorization", `Bearer ${tokenFor(randomUUID(), "VERIFICATION_OFFICER")}`);
  assert.equal(officerResponse.status, 403);
  assert.equal(officerResponse.body.code, "FORBIDDEN_ROLE");

  const adminToken = tokenFor(randomUUID(), "ADMIN");
  const draft = {
    code: "TIER_9",
    name: "Test staged tier",
    description: "Created by the tier suite; never activated by a deployment.",
    minimumDocuments: 1,
    requiresLiveness: false,
    requiredFields: ["firstName", "lastName", "dateOfBirth"],
    requiredDocumentTypes: ["national_id"],
    allowedOperations: ["DEPOSIT"],
    reviewIntervalDays: 365,
    approvalValidDays: 180,
    reVerificationLeadDays: 21,
  };

  const created_ = await request(app)
    .post(`${KYC}/admin/tiers`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send(draft);
  assert.equal(created_.status, 201);
  assert.equal(created_.body.data.version, 1);
  assert.equal(created_.body.data.isActive, false);
  created.tierDefinitionIds.push(created_.body.data.id);

  const limits = await request(app)
    .put(`${KYC}/admin/tiers/${created_.body.data.id}/limits`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      limits: [
        {
          operation: "DEPOSIT",
          currency: "ETB",
          minAmount: "0",
          maxAmount: "1234.56",
          dailyAmount: "5000.00",
          dailyCount: 3,
          monthlyAmount: "20000.00",
          maxBalance: "25000.00",
          isAllowed: true,
        },
      ],
    });
  assert.equal(limits.status, 200);
  assert.equal(limits.body.data.limits[0].maxAmount, "1234.56");

  // A version with no limits cannot be activated, so a half-written policy can
  // never reach a live transaction.
  const early = await request(app)
    .post(`${KYC}/admin/tiers`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ ...draft, code: "TIER_8" });
  assert.equal(early.status, 201);
  created.tierDefinitionIds.push(early.body.data.id);
  const activateEmpty = await request(app)
    .post(`${KYC}/admin/tiers/${early.body.data.id}/activate`)
    .set("Authorization", `Bearer ${adminToken}`);
  assert.equal(activateEmpty.status, 409);
  assert.equal(activateEmpty.body.code, "TIER_LIMITS_MISSING");

  const activate = await request(app)
    .post(`${KYC}/admin/tiers/${created_.body.data.id}/activate`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send();
  assert.equal(activate.status, 200);
  assert.equal(activate.body.data.isActive, true);

  const nextVersion = await request(app)
    .post(`${KYC}/admin/tiers`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ ...draft, name: "Test staged tier v2", limits: [limits.body.data.limits[0]] });
  assert.equal(nextVersion.status, 201);
  assert.equal(nextVersion.body.data.version, 2);
  created.tierDefinitionIds.push(nextVersion.body.data.id);

  const promote = await request(app)
    .post(`${KYC}/admin/tiers/${nextVersion.body.data.id}/activate`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send();
  assert.equal(promote.status, 200);

  const active = await prisma.kycTierDefinition.count({
    where: { code: "TIER_9", isActive: true },
  });
  assert.equal(active, 1, "only one version of a code is live");

  const inUse = await request(app)
    .post(`${KYC}/admin/tiers/${definitions.TIER_1.id}/retire`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send();
  assert.equal(inUse.status, 409);
  assert.equal(inUse.body.code, "TIER_IN_USE");

  await request(app)
    .post(`${KYC}/admin/tiers/${created_.body.data.id}/retire`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send();
});

testFn("tier activity is exported for monitoring", async () => {
  const response = await request(app).get("/metrics");

  assert.equal(response.status, 200);
  assert.match(response.text, /banking_kyc_tier_assignments_total/);
  assert.match(response.text, /direction="UPGRADE"/);
});
