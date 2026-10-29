const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://auth:auth@localhost:5432/kyc_test?schema=public";
process.env.JWT_SECRET = "kyc-workflow-test-secret";
process.env.JWT_ISSUER = "auth-service";
process.env.JWT_AUDIENCE = "banking-system";
process.env.ENABLE_API_DOCS = "false";
process.env.DIDIT_API_BASE_URL = "https://verification.didit.me";
process.env.STORAGE_ENCRYPTION_KEY = "13".repeat(32);

const submissions = new Map([
  ["submission-match", {
    id: "submission-match",
    userId: "customer-1",
    status: "DRAFT",
    providerStatus: "Approved",
    documentVerificationStatus: "Approved",
    dataComparisonStatus: null,
    faceMatchStatus: "Approved",
    livenessStatus: "Approved",
  }],
  ["submission-mismatch", {
    id: "submission-mismatch",
    userId: "customer-1",
    status: "DRAFT",
    providerStatus: "Approved",
    documentVerificationStatus: "Approved",
    dataComparisonStatus: null,
    faceMatchStatus: "Approved",
    livenessStatus: "Approved",
  }],
  ["submission-review-compare", {
    id: "submission-review-compare",
    userId: "customer-1",
    status: "PENDING_REVIEW",
    providerStatus: "Approved",
    documentVerificationStatus: "Approved",
    dataComparisonStatus: null,
    faceMatchStatus: "Approved",
    livenessStatus: "Approved",
  }],
  ["submission-no-evidence", {
    id: "submission-no-evidence",
    userId: "customer-1",
    status: "PENDING_REVIEW",
    providerStatus: "Approved",
    documentVerificationStatus: "Approved",
    dataComparisonStatus: "MATCH",
    faceMatchStatus: "Approved",
    livenessStatus: "Approved",
  }],
  ["submission-declined-provider", {
    id: "submission-declined-provider",
    userId: "customer-1",
    status: "PENDING_REVIEW",
    providerStatus: "Declined",
    documentVerificationStatus: "Declined",
    dataComparisonStatus: "MATCH",
    faceMatchStatus: "Approved",
    livenessStatus: "Approved",
  }],
  ["submission-not-pending", {
    id: "submission-not-pending",
    userId: "customer-1",
    status: "DRAFT",
    providerStatus: "Approved",
    documentVerificationStatus: "Approved",
    dataComparisonStatus: "MATCH",
    faceMatchStatus: "Approved",
    livenessStatus: "Approved",
  }],
]);
const auditEvents = [];
const reviewEvents = [];
let ocrDocuments = [];
let evidenceCount = 1;
const fakePrisma = {
  $transaction: async (callback) => callback(fakePrisma),
  kycSubmission: {
    findFirst: async ({ where }) => {
      const submission = submissions.get(where.id);
      return submission?.userId === where.userId ? { ...submission } : null;
    },
    findMany: async ({ where }) =>
      [...submissions.values()].filter((submission) => submission.status === where.status),
    findUnique: async ({ where }) => {
      const submission = submissions.get(where.id);
      return submission ? { ...submission } : null;
    },
    update: async ({ where, data }) => {
      const submission = submissions.get(where.id);
      Object.assign(submission, data);
      return { ...submission };
    },
    updateMany: async ({ where, data }) => {
      const submission = submissions.get(where.id);
      if (!submission) return { count: 0 };
      if (where.userId && submission.userId !== where.userId) return { count: 0 };
      const statusFilter = where.status;
      const statusMatches =
        typeof statusFilter === "string"
          ? submission.status === statusFilter
          : Array.isArray(statusFilter?.in)
            ? statusFilter.in.includes(submission.status)
            : true;
      if (!statusMatches) return { count: 0 };
      Object.assign(submission, data);
      return { count: 1 };
    },
  },
  kycDocument: {
    findMany: async () => ocrDocuments,
    count: async ({ where }) => (where?.submissionId ? evidenceCount : 0),
  },
  kycAuditEvent: {
    create: async ({ data }) => {
      auditEvents.push(data);
      return data;
    },
  },
  kycReview: {
    create: async ({ data }) => {
      reviewEvents.push(data);
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
const secureStorage = require("../src/utils/secureStorage");
const app = require("../src/app");
const jwt = require("jsonwebtoken");
const customerToken = jwt.sign(
  { sub: "customer-1", typ: "access", role: "USER" },
  process.env.JWT_SECRET,
  { expiresIn: "5m", issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE }
);
const officerToken = jwt.sign(
  { sub: "officer-1", typ: "access", role: "VERIFICATION_OFFICER" },
  process.env.JWT_SECRET,
  { expiresIn: "5m", issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE }
);
const profile = {
  id: "user-service-profile-1",
  firstName: "Ada",
  lastName: "Lovelace",
  dateOfBirth: "1815-12-13T00:00:00.000Z",
};
const makeDocument = (entries) => ({
  id: "document-1",
  extractedData: secureStorage.encryptSensitiveValue(
    JSON.stringify({
      fields: entries.map(([label, value], index) => ({
        key: `field_${index + 1}`,
        label,
        value,
        needsCorrection: false,
      })),
    })
  ),
});

test("comparison normalizes names and unambiguous date representations", async () => {
  ocrDocuments = [
    makeDocument([
      ["First Name", "Áda"],
      ["Last Name", "Love-lace"],
      ["Date of Birth", "13/12/1815"],
    ]),
  ];
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: { user: profile } }),
  });

  try {
    const response = await request(app)
      .post("/api/v1/kyc/submissions/submission-match/compare")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({});

    assert.equal(response.status, 200);
    assert.equal(response.body.data.status, "MATCH");
    assert.deepEqual(response.body.data.fields.map(({ status }) => status), [
      "MATCH",
      "MATCH",
      "MATCH",
    ]);
    assert.equal(submissions.get("submission-match").dataComparisonStatus, "MATCH");
  } finally {
    global.fetch = originalFetch;
  }
});

test("comparison marks mismatches and ambiguous or duplicate OCR fields for review", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: { user: profile } }),
  });

  try {
    ocrDocuments = [
      makeDocument([
        ["First Name", "Ada"],
        ["Last Name", "Byron"],
        ["Date of Birth", "13/12/1815"],
      ]),
    ];
    const mismatch = await request(app)
      .post("/api/v1/kyc/submissions/submission-mismatch/compare")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({});
    assert.equal(mismatch.status, 200);
    assert.equal(mismatch.body.data.status, "MISMATCH");

    ocrDocuments = [
      makeDocument([
        ["First Name", "Ada"],
        ["First Name", "Ada"],
        ["Last Name", "Lovelace"],
        ["Date of Birth", "11/12/1815"],
      ]),
    ];
    const reviewRequired = await request(app)
      .post("/api/v1/kyc/submissions/submission-mismatch/compare")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({});
    assert.equal(reviewRequired.body.data.status, "REVIEW_REQUIRED");
    assert.equal(reviewRequired.body.data.fields[0].status, "REVIEW_REQUIRED");
    assert.equal(reviewRequired.body.data.fields[2].status, "REVIEW_REQUIRED");
  } finally {
    global.fetch = originalFetch;
  }
});

test("officers can approve only when every configured policy check passes", async () => {
  const submission = submissions.get("submission-match");
  submission.status = "PENDING_REVIEW";
  submission.dataComparisonStatus = "MATCH";

  const approved = await request(app)
    .post("/api/v1/kyc/officer/submissions/submission-match/decision")
    .set("Authorization", `Bearer ${officerToken}`)
    .send({ decision: "APPROVE", reason: "All required checks passed." });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.data.status, "APPROVED");
  assert.equal(reviewEvents.at(-1).reviewerId, "officer-1");

  submissions.get("submission-mismatch").status = "PENDING_REVIEW";
  const blocked = await request(app)
    .post("/api/v1/kyc/officer/submissions/submission-mismatch/decision")
    .set("Authorization", `Bearer ${officerToken}`)
    .send({ decision: "APPROVE", reason: "Attempted approval." });
  assert.equal(blocked.status, 409);

  const selfReviewToken = jwt.sign(
    { sub: "customer-1", typ: "access", role: "VERIFICATION_OFFICER" },
    process.env.JWT_SECRET,
    { expiresIn: "5m", issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE }
  );
  const selfReview = await request(app)
    .post("/api/v1/kyc/officer/submissions/submission-mismatch/decision")
    .set("Authorization", `Bearer ${selfReviewToken}`)
    .send({ decision: "REJECT", reason: "Self-review attempt." });
  assert.equal(selfReview.status, 403);
});

test("users without an officer role cannot access the review queue", async () => {
  const response = await request(app)
    .get("/api/v1/kyc/officer/reviews")
    .set("Authorization", `Bearer ${customerToken}`);
  assert.equal(response.status, 403);
});

test("comparison can complete during review and then satisfy the approval requirements", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: { user: profile } }),
  });
  ocrDocuments = [
    makeDocument([
      ["First Name", "Ada"],
      ["Last Name", "Lovelace"],
      ["Date of Birth", "13/12/1815"],
    ]),
  ];

  try {
    const comparison = await request(app)
      .post("/api/v1/kyc/submissions/submission-review-compare/compare")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({});
    assert.equal(comparison.status, 200);
    assert.equal(comparison.body.data.status, "MATCH");
    assert.equal(
      submissions.get("submission-review-compare").dataComparisonStatus,
      "MATCH"
    );

    const approved = await request(app)
      .post("/api/v1/kyc/officer/submissions/submission-review-compare/decision")
      .set("Authorization", `Bearer ${officerToken}`)
      .send({ decision: "APPROVE", reason: "Comparison completed while in review." });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.data.status, "APPROVED");
  } finally {
    global.fetch = originalFetch;
  }
});

test("approval is rejected when no identity document evidence exists", async () => {
  evidenceCount = 0;
  try {
    const response = await request(app)
      .post("/api/v1/kyc/officer/submissions/submission-no-evidence/decision")
      .set("Authorization", `Bearer ${officerToken}`)
      .send({ decision: "APPROVE", reason: "Attempted approval without evidence." });
    assert.equal(response.status, 409);
    assert.match(response.body.message, /identity document/i);
    assert.equal(submissions.get("submission-no-evidence").status, "PENDING_REVIEW");
  } finally {
    evidenceCount = 1;
  }
});

test("approval is rejected when the provider declined verification", async () => {
  const response = await request(app)
    .post("/api/v1/kyc/officer/submissions/submission-declined-provider/decision")
    .set("Authorization", `Bearer ${officerToken}`)
    .send({ decision: "APPROVE", reason: "Attempted approval after decline." });
  assert.equal(response.status, 409);
  assert.match(response.body.message, /Approval requires/i);
  assert.equal(submissions.get("submission-declined-provider").status, "PENDING_REVIEW");
});

test("approval is rejected when the applicant comparison failed", async () => {
  submissions.get("submission-mismatch").status = "PENDING_REVIEW";
  submissions.get("submission-mismatch").dataComparisonStatus = "MISMATCH";
  const response = await request(app)
    .post("/api/v1/kyc/officer/submissions/submission-mismatch/decision")
    .set("Authorization", `Bearer ${officerToken}`)
    .send({ decision: "APPROVE", reason: "Attempted approval after mismatch." });
  assert.equal(response.status, 409);
  assert.equal(submissions.get("submission-mismatch").status, "PENDING_REVIEW");
});

test("a decision cannot be recorded for a submission that is not awaiting review", async () => {
  const response = await request(app)
    .post("/api/v1/kyc/officer/submissions/submission-not-pending/decision")
    .set("Authorization", `Bearer ${officerToken}`)
    .send({ decision: "APPROVE", reason: "Attempted invalid transition." });
  assert.equal(response.status, 409);
  assert.equal(submissions.get("submission-not-pending").status, "DRAFT");
});

test("the officer queue only lists submissions awaiting review", async () => {
  const response = await request(app)
    .get("/api/v1/kyc/officer/reviews")
    .set("Authorization", `Bearer ${officerToken}`);
  assert.equal(response.status, 200);
  const ids = response.body.data.map((submission) => submission.id);
  assert.equal(ids.includes("submission-no-evidence"), true);
  assert.equal(ids.includes("submission-match"), false);
  assert.equal(ids.includes("submission-not-pending"), false);
});
