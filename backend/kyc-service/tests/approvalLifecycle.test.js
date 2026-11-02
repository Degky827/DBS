const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const request = require("supertest");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://auth:auth@localhost:5432/kyc_test?schema=public";
process.env.JWT_SECRET = "kyc-approval-lifecycle-secret";
process.env.JWT_ISSUER = "auth-service";
process.env.JWT_AUDIENCE = "banking-system";
process.env.ENABLE_API_DOCS = "false";
process.env.DIDIT_API_BASE_URL = "https://verification.didit.me";
process.env.INTERNAL_SERVICE_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.KYC_APPROVAL_TTL_DAYS = "30";
process.env.STORAGE_ENCRYPTION_KEY = "15".repeat(32);

const submissions = new Map();
const auditEvents = [];
const reviews = [];
const evidenceCount = 1;
let idCounter = 0;

const users = {
  approve: "11111111-1111-4111-8111-111111111111",
  expired: "22222222-2222-4222-8222-222222222222",
  revoke: "33333333-3333-4333-8333-333333333333",
  approved: "44444444-4444-4444-8444-444444444444",
  draft: "55555555-5555-4555-8555-555555555555",
  pending: "66666666-6666-4666-8666-666666666666",
};

const approvedFields = (overrides = {}) => ({
  providerStatus: "Approved",
  documentVerificationStatus: "Approved",
  dataComparisonStatus: "MATCH",
  faceMatchStatus: "Approved",
  livenessStatus: "Approved",
  ...overrides,
});

const addSubmission = (submission) => {
  submissions.set(submission.id, {
    createdAt: new Date(),
    updatedAt: new Date(),
    approvedAt: null,
    approvalExpiresAt: null,
    revokedAt: null,
    revokedReason: null,
    ...submission,
  });
};

addSubmission({
  id: "pending-approval",
  userId: users.approve,
  status: "PENDING_REVIEW",
  ...approvedFields(),
});
addSubmission({
  id: "approved-active",
  userId: users.expired,
  status: "APPROVED",
  approvedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
  approvalExpiresAt: new Date(Date.now() - 1000),
  reviewedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
  ...approvedFields(),
});
addSubmission({
  id: "approved-revoke",
  userId: users.revoke,
  status: "APPROVED",
  approvedAt: new Date(),
  approvalExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  reviewedAt: new Date(),
  ...approvedFields(),
});
addSubmission({
  id: "approved-effective",
  userId: users.approved,
  status: "APPROVED",
  approvedAt: new Date(),
  approvalExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  reviewedAt: new Date(),
  ...approvedFields(),
});
addSubmission({
  id: "draft-existing",
  userId: users.draft,
  status: "DRAFT",
});
addSubmission({
  id: "pending-existing",
  userId: users.pending,
  status: "PENDING_REVIEW",
});

const matchesWhere = (submission, where) => {
  if (where.id && submission.id !== where.id) return false;
  if (where.userId && submission.userId !== where.userId) return false;
  if (where.status && submission.status !== where.status) return false;
  if (where.revokedAt === null && submission.revokedAt !== null) return false;
  return true;
};

const fakePrisma = {
  $transaction: async (callback) => callback(fakePrisma),
  kycSubmission: {
    findUnique: async ({ where }) => {
      const submission = submissions.get(where.id);
      return submission ? { ...submission } : null;
    },
    findFirst: async ({ where }) => {
      const candidates = [...submissions.values()]
        .filter((submission) => matchesWhere(submission, where))
        .sort((left, right) => right.createdAt - left.createdAt);
      return candidates[0] ? { ...candidates[0] } : null;
    },
    create: async ({ data }) => {
      const submission = {
        id: `submission-new-${++idCounter}`,
        status: "DRAFT",
        createdAt: new Date(),
        updatedAt: new Date(),
        approvedAt: null,
        approvalExpiresAt: null,
        revokedAt: null,
        revokedReason: null,
        ...data,
      };
      submissions.set(submission.id, submission);
      return { ...submission };
    },
    updateMany: async ({ where, data }) => {
      const submission = submissions.get(where.id);
      if (!submission || !matchesWhere(submission, where)) return { count: 0 };
      Object.assign(submission, data);
      return { count: 1 };
    },
  },
  kycDocument: {
    count: async ({ where }) => (where?.submissionId ? evidenceCount : 0),
  },
  kycReview: {
    create: async ({ data }) => {
      reviews.push(data);
      return data;
    },
  },
  kycAuditEvent: {
    create: async ({ data }) => {
      auditEvents.push(data);
      return data;
    },
  },
};

const databasePath = require.resolve("../src/config/database");
require.cache[databasePath] = {
  id: databasePath,
  filename: databasePath,
  loaded: true,
  exports: fakePrisma,
};

const app = require("../src/app");

const tokenFor = (sub, role) =>
  jwt.sign({ sub, typ: "access", role }, process.env.JWT_SECRET, {
    expiresIn: "5m",
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE,
  });

const officerToken = tokenFor("officer-1", "VERIFICATION_OFFICER");

const officerDecision = (submissionId, decision, reason) =>
  request(app)
    .post(`/api/v1/kyc/officer/submissions/${submissionId}/decision`)
    .set("Authorization", `Bearer ${officerToken}`)
    .send({ decision, reason });

const internalStatus = (userId) =>
  request(app)
    .get(`/api/v1/kyc/internal/users/${userId}/status`)
    .set("X-Internal-Service-Key", process.env.INTERNAL_SERVICE_KEY);

test("approval is recorded with a bounded expiry", async () => {
  const response = await officerDecision(
    "pending-approval",
    "APPROVE",
    "All verification requirements passed."
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.data.status, "APPROVED");
  const approvedAt = new Date(response.body.data.approvedAt);
  const approvalExpiresAt = new Date(response.body.data.approvalExpiresAt);
  assert.ok(!Number.isNaN(approvedAt.getTime()));
  assert.ok(!Number.isNaN(approvalExpiresAt.getTime()));
  assert.equal(
    approvalExpiresAt.getTime() - approvedAt.getTime(),
    30 * 24 * 60 * 60 * 1000
  );

  const status = await internalStatus(users.approve);
  assert.equal(status.status, 200);
  assert.equal(status.body.data.isApproved, true);
  assert.equal(status.body.data.effectiveStatus, "APPROVED");
});

test("an expired approval is no longer treated as approved", async () => {
  const internal = await internalStatus(users.expired);
  assert.equal(internal.body.data.isApproved, false);
  assert.equal(internal.body.data.approvalExpired, true);
  assert.equal(internal.body.data.effectiveStatus, "EXPIRED");

  const customer = await request(app)
    .get("/api/v1/kyc/status")
    .set("Authorization", `Bearer ${tokenFor(users.expired, "USER")}`);
  assert.equal(customer.status, 200);
  assert.equal(customer.body.data.isApproved, false);
  assert.equal(customer.body.data.effectiveStatus, "EXPIRED");
});

test("an officer can revoke an approval and the applicant must resubmit", async () => {
  const response = await request(app)
    .post("/api/v1/kyc/officer/submissions/approved-revoke/revoke")
    .set("Authorization", `Bearer ${officerToken}`)
    .send({ reason: "Document forgery suspected during audit." });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.status, "NEEDS_RESUBMISSION");
  assert.ok(!Number.isNaN(new Date(response.body.data.revokedAt).getTime()));
  assert.equal(
    response.body.data.revokedReason,
    "Document forgery suspected during audit."
  );
  assert.equal(reviews.at(-1).decision, "REVOKE");
  assert.equal(auditEvents.at(-1).eventType, "OFFICER_APPROVAL_REVOKED");

  const internal = await internalStatus(users.revoke);
  assert.equal(internal.body.data.isApproved, false);
  assert.equal(internal.body.data.effectiveStatus, "NEEDS_RESUBMISSION");

  const again = await request(app)
    .post("/api/v1/kyc/officer/submissions/approved-revoke/revoke")
    .set("Authorization", `Bearer ${officerToken}`)
    .send({ reason: "Second revocation attempt." });
  assert.equal(again.status, 409);
});

test("submission creation respects existing applications and approvals", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: { user: { id: "profile-1" } } }),
  });

  try {
    const approved = await request(app)
      .post("/api/v1/kyc/submissions")
      .set("Authorization", `Bearer ${tokenFor(users.approved, "USER")}`)
      .send({});
    assert.equal(approved.status, 409);
    assert.equal(approved.body.code, "KYC_ALREADY_APPROVED");

    const draft = await request(app)
      .post("/api/v1/kyc/submissions")
      .set("Authorization", `Bearer ${tokenFor(users.draft, "USER")}`)
      .send({});
    assert.equal(draft.status, 200);
    assert.equal(draft.body.data.id, "draft-existing");
    assert.equal(draft.body.data.reused, true);

    const pending = await request(app)
      .post("/api/v1/kyc/submissions")
      .set("Authorization", `Bearer ${tokenFor(users.pending, "USER")}`)
      .send({});
    assert.equal(pending.status, 409);
    assert.equal(pending.body.code, "KYC_APPLICATION_IN_PROGRESS");

    const expired = await request(app)
      .post("/api/v1/kyc/submissions")
      .set("Authorization", `Bearer ${tokenFor(users.expired, "USER")}`)
      .send({});
    assert.equal(expired.status, 201);
    assert.notEqual(expired.body.data.id, "approved-active");

    const internal = await internalStatus(users.expired);
    assert.equal(internal.body.data.isApproved, false);
  } finally {
    global.fetch = originalFetch;
  }
});
