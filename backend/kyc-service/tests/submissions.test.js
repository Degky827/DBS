const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const request = require("supertest");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://auth:auth@localhost:5432/kyc_test?schema=public";
process.env.JWT_SECRET = "kyc-service-test-secret";
process.env.JWT_ISSUER = "auth-service";
process.env.JWT_AUDIENCE = "banking-system";
process.env.ENABLE_API_DOCS = "false";
process.env.DIDIT_API_BASE_URL = "https://verification.didit.me";

const submissions = [];
const auditEvents = [];
const fakePrisma = {
  $transaction: async (callback) => callback(fakePrisma),
  kycSubmission: {
    create: async ({ data }) => {
      const submission = {
        id: `submission-${submissions.length + 1}`,
        ...data,
        status: "DRAFT",
        createdAt: new Date("2026-10-26T00:00:00.000Z"),
        updatedAt: new Date("2026-10-26T00:00:00.000Z"),
      };
      submissions.push(submission);
      return submission;
    },
    findFirst: async ({ where, select }) => {
      assert.ok(select);
      return submissions
        .filter((submission) => submission.userId === where.userId)
        .at(-1) || null;
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
const TEST_USER_ID = "auth-user-123";
const token = jwt.sign(
  { sub: TEST_USER_ID, typ: "access", role: "USER" },
  process.env.JWT_SECRET,
  {
    expiresIn: "5m",
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE,
  }
);

test("customer creates an owned submission after profile lookup", async () => {
  const originalFetch = global.fetch;
  let requestedUrl;
  let forwardedAuthorization;
  global.fetch = async (url, options) => {
    requestedUrl = url;
    forwardedAuthorization = options.headers.Authorization;
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { user: { id: "profile-456" } } }),
    };
  };

  try {
    const response = await request(app)
      .post("/api/v1/kyc/submissions")
      .set("Authorization", `Bearer ${token}`)
      .send({});

    assert.equal(response.status, 201);
    assert.equal(response.body.data.status, "DRAFT");
    assert.equal(submissions[0].userId, TEST_USER_ID);
    assert.equal(requestedUrl, "http://localhost:5002/api/v1/users/me");
    assert.equal(forwardedAuthorization, `Bearer ${token}`);
    assert.deepEqual(auditEvents[0], {
      submissionId: "submission-1",
      eventType: "SUBMISSION_CREATED",
      actorId: TEST_USER_ID,
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("status lookup is scoped to the authenticated customer's token subject", async () => {
  const response = await request(app)
    .get("/api/v1/kyc/status")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.id, "submission-1");
  assert.equal(response.body.data.status, "DRAFT");
});

test("submission request cannot choose a different customer id", async () => {
  const response = await request(app)
    .post("/api/v1/kyc/submissions")
    .set("Authorization", `Bearer ${token}`)
    .send({ userId: "somebody-else" });

  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
});

test("expired access tokens are rejected", async () => {
  const expiredToken = jwt.sign(
    { sub: TEST_USER_ID, typ: "access" },
    process.env.JWT_SECRET,
    {
      expiresIn: -1,
      issuer: process.env.JWT_ISSUER,
      audience: process.env.JWT_AUDIENCE,
    }
  );
  const response = await request(app)
    .get("/api/v1/kyc/status")
    .set("Authorization", `Bearer ${expiredToken}`);

  assert.equal(response.status, 401);
  assert.equal(response.body.message, "Access token expired");
});

test("invalid access tokens are rejected", async () => {
  const response = await request(app)
    .get("/api/v1/kyc/status")
    .set("Authorization", "Bearer invalid.token.value");

  assert.equal(response.status, 401);
  assert.equal(response.body.message, "Invalid access token");
});

test("status lookup returns not found when this customer has no submission", async () => {
  const otherCustomerToken = jwt.sign(
    { sub: "auth-user-without-submission", typ: "access" },
    process.env.JWT_SECRET,
    {
      expiresIn: "5m",
      issuer: process.env.JWT_ISSUER,
      audience: process.env.JWT_AUDIENCE,
    }
  );
  const response = await request(app)
    .get("/api/v1/kyc/status")
    .set("Authorization", `Bearer ${otherCustomerToken}`);

  assert.equal(response.status, 404);
  assert.equal(response.body.success, false);
});

test("unavailable user-service prevents submission creation", async () => {
  const originalFetch = global.fetch;
  const submissionCount = submissions.length;
  global.fetch = async () => {
    throw new TypeError("fetch failed");
  };

  try {
    const response = await request(app)
      .post("/api/v1/kyc/submissions")
      .set("Authorization", `Bearer ${token}`)
      .send({});

    assert.equal(response.status, 503);
    assert.equal(response.body.success, false);
    assert.equal(submissions.length, submissionCount);
  } finally {
    global.fetch = originalFetch;
  }
});

test("status lookup does not expose another customer's submission", async () => {
  submissions.push({
    id: "other-customer-submission",
    userId: "auth-user-999",
    status: "APPROVED",
    createdAt: new Date("2026-10-27T00:00:00.000Z"),
  });

  const response = await request(app)
    .get("/api/v1/kyc/status")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.id, "submission-1");
  assert.notEqual(response.body.data.id, "other-customer-submission");
});
