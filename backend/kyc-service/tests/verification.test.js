const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const request = require("supertest");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://auth:auth@localhost:5432/kyc_test?schema=public";
process.env.JWT_SECRET = "kyc-verification-test-secret";
process.env.JWT_ISSUER = "auth-service";
process.env.JWT_AUDIENCE = "banking-system";
process.env.ENABLE_API_DOCS = "false";
process.env.DIDIT_API_BASE_URL = "https://verification.didit.me";
process.env.DIDIT_API_KEY = "test-didit-api-key";
process.env.DIDIT_WORKFLOW_ID = "published-workflow-id";
process.env.DIDIT_WEBHOOK_SECRET = "test-webhook-secret";
process.env.DIDIT_WEBHOOK_SECRET_PREVIOUS = "previous-test-webhook-secret";
process.env.STORAGE_ENCRYPTION_KEY = "14".repeat(32);

const submissions = new Map([
  ["submission-1", {
    id: "submission-1",
    userId: "customer-1",
    status: "DRAFT",
    providerSessionId: null,
    providerSessionUrlEncrypted: null,
    providerStatus: "In Review",
    documentVerificationStatus: "In Review",
    dataComparisonStatus: "MATCH",
    comparisonResults: [{ field: "firstName", status: "MATCH" }],
    faceMatchStatus: "Approved",
    livenessStatus: "Approved",
  }],
  ["submission-declined", {
    id: "submission-declined",
    userId: "customer-1",
    status: "DRAFT",
    providerSessionId: "didit-session-declined",
    providerSessionUrlEncrypted: "encrypted",
    providerStatus: null,
    documentVerificationStatus: null,
    dataComparisonStatus: null,
    faceMatchStatus: null,
    livenessStatus: null,
  }],
  ["submission-terminal", {
    id: "submission-terminal",
    userId: "customer-1",
    status: "APPROVED",
    providerSessionId: "didit-session-terminal",
    providerSessionUrlEncrypted: "encrypted",
    providerStatus: "Approved",
    documentVerificationStatus: "Approved",
    dataComparisonStatus: "MATCH",
    faceMatchStatus: "Approved",
    livenessStatus: "Approved",
  }],
  ["submission-order", {
    id: "submission-order",
    userId: "customer-1",
    status: "PENDING_REVIEW",
    providerSessionId: "didit-session-order",
    providerSessionUrlEncrypted: "encrypted",
    providerStatus: "Approved",
    documentVerificationStatus: "Approved",
    dataComparisonStatus: "MATCH",
    faceMatchStatus: "Approved",
    livenessStatus: "Approved",
  }],
  ["submission-compare", {
    id: "submission-compare",
    userId: "customer-1",
    status: "PENDING_REVIEW",
    providerSessionId: "didit-session-compare",
    providerSessionUrlEncrypted: "encrypted",
    providerStatus: "Approved",
    documentVerificationStatus: "Approved",
    dataComparisonStatus: "MATCH",
    comparisonResults: [{ field: "firstName", status: "MATCH" }],
    faceMatchStatus: "Approved",
    livenessStatus: "Approved",
  }],
]);
const providerEvents = new Map();
const auditEvents = [];
const { Prisma } = require("@prisma/client");
function applyData(target, data) {
  for (const [key, value] of Object.entries(data)) {
    target[key] = value === Prisma.DbNull ? null : value;
  }
}
const fakePrisma = {
  $transaction: async (callback) => callback(fakePrisma),
  $queryRaw: async (strings, ...values) => {
    const submission = submissions.get(values[0]);
    return submission ? [{ id: submission.id, status: submission.status }] : [];
  },
  kycSubmission: {
    findFirst: async ({ where }) => {
      const submission = submissions.get(where.id);
      return submission?.userId === where.userId ? { ...submission } : null;
    },
    findUnique: async ({ where }) => {
      if (where.providerSessionId) {
        return [...submissions.values()].find(
          (item) => item.providerSessionId === where.providerSessionId
        ) || null;
      }
      return submissions.get(where.id) || null;
    },
    update: async ({ where, data }) => {
      const submission = submissions.get(where.id);
      applyData(submission, data);
      return { ...submission };
    },
    updateMany: async ({ where, data }) => {
      const submission = submissions.get(where.id);
      if (!submission) return { count: 0 };
      if (where.userId && submission.userId !== where.userId) return { count: 0 };
      if (typeof where.status === "string" && submission.status !== where.status) {
        return { count: 0 };
      }
      applyData(submission, data);
      return { count: 1 };
    },
  },
  kycProviderEvent: {
    findUnique: async ({ where }) => providerEvents.get(where.eventId) || null,
    findFirst: async ({ where }) => {
      const events = [...providerEvents.values()]
        .filter((item) => item.submissionId === where.submissionId)
        .sort((left, right) => right.eventTimestamp - left.eventTimestamp);
      return events[0] ? { eventTimestamp: events[0].eventTimestamp } : null;
    },
    create: async ({ data }) => {
      if (providerEvents.has(data.eventId)) {
        const error = new Error("duplicate event");
        error.code = "P2002";
        throw error;
      }
      providerEvents.set(data.eventId, data);
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
const { canonicalizeJson } = require("../src/utils/diditWebhookSignature");
const jwt = require("jsonwebtoken");
const token = jwt.sign(
  { sub: "customer-1", typ: "access", role: "USER" },
  process.env.JWT_SECRET,
  { expiresIn: "5m", issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE }
);

function signV2(event, secret = process.env.DIDIT_WEBHOOK_SECRET) {
  return crypto
    .createHmac("sha256", secret)
    .update(canonicalizeJson(event))
    .digest("hex");
}

function signRaw(body, secret = process.env.DIDIT_WEBHOOK_SECRET) {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

test("canonicalizes Didit V2 JSON with sorted keys, normalized whole numbers, and Unicode", () => {
  const event = JSON.parse(
    '{"é":"José 李","10":"ten","2":"two","nested":{"z":1.0,"a":1e0},"items":[{"b":"café","a":2.0}]}'
  );

  assert.equal(
    canonicalizeJson(event),
    '{"2":"two","10":"ten","items":[{"a":2,"b":"café"}],"nested":{"a":1,"z":1},"é":"José 李"}'
  );
});

test("creates a documented Didit session with the configured workflow and no exposed token", async () => {
  const originalFetch = global.fetch;
  let diditRequest;
  global.fetch = async (url, options) => {
    diditRequest = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      status: 201,
      json: async () => ({
        session_id: "didit-session-1",
        url: "https://verify.didit.me/session/secret-link",
        session_token: "must-not-be-returned-or-stored",
      }),
    };
  };

  try {
    const response = await request(app)
      .post("/api/v1/kyc/submissions/submission-1/verification-session")
      .set("Authorization", `Bearer ${token}`)
      .send({});

    assert.equal(response.status, 200);
    assert.equal(response.body.data.sessionId, "didit-session-1");
    assert.equal(response.body.data.sessionUrl, "https://verify.didit.me/session/secret-link");
    assert.equal("session_token" in response.body.data, false);
    assert.equal(submissions.get("submission-1").providerSessionId, "didit-session-1");
    assert.notEqual(
      submissions.get("submission-1").providerSessionUrlEncrypted,
      "https://verify.didit.me/session/secret-link"
    );
    assert.equal(submissions.get("submission-1").providerStatus, "Not Started");
    assert.equal(submissions.get("submission-1").documentVerificationStatus, null);
    assert.equal(submissions.get("submission-1").dataComparisonStatus, null);
    assert.equal(submissions.get("submission-1").comparisonResults, null);
    assert.equal(submissions.get("submission-1").submittedAt, null);
    assert.equal(submissions.get("submission-1").faceMatchStatus, null);
    assert.equal(submissions.get("submission-1").livenessStatus, null);
    assert.equal(diditRequest.url, "https://verification.didit.me/v3/session/");
    assert.equal(diditRequest.options.headers["x-api-key"], "test-didit-api-key");
    assert.equal(diditRequest.body.workflow_id, "published-workflow-id");
    assert.equal(diditRequest.body.vendor_data, "submission-1");

    const reused = await request(app)
      .post("/api/v1/kyc/submissions/submission-1/verification-session")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    assert.equal(reused.status, 200);
    assert.equal(reused.body.data.reused, true);
    assert.equal(reused.body.data.sessionUrl, response.body.data.sessionUrl);
  } finally {
    global.fetch = originalFetch;
  }
});

test("verifies V2 signatures against the signed body timestamp and persists session results", async () => {
  const event = {
    event_id: "event-1",
    session_id: "didit-session-1",
    status: "Approved",
    webhook_type: "status.updated",
    timestamp: Math.floor(Date.now() / 1000),
    decision: {
      id_verifications: [{ status: "Approved" }],
      face_matches: [{ status: "Approved" }],
      liveness_checks: [{ status: "Approved" }],
    },
  };
  const signature = signV2(event);

  const response = await request(app)
    .post("/api/v1/kyc/webhooks/didit")
    .set("Content-Type", "application/json")
    .set("X-Timestamp", "1")
    .set("X-Signature-V2", signature)
    .send(JSON.stringify(event));

  assert.equal(response.status, 202);
  assert.equal(response.body.data.accepted, true);
  assert.equal(submissions.get("submission-1").providerStatus, "Approved");
  assert.equal(submissions.get("submission-1").status, "PENDING_REVIEW");
  assert.ok(submissions.get("submission-1").submittedAt instanceof Date);
  assert.equal(
    submissions.get("submission-1").submittedAt.getTime(),
    event.timestamp * 1000
  );
  assert.equal(submissions.get("submission-1").documentVerificationStatus, "Approved");
  assert.equal(submissions.get("submission-1").faceMatchStatus, "Approved");
  assert.equal(submissions.get("submission-1").livenessStatus, "Approved");
  // Provider data must never be interpreted as an applicant-data comparison.
  assert.equal(submissions.get("submission-1").dataComparisonStatus, null);

  const duplicate = await request(app)
    .post("/api/v1/kyc/webhooks/didit")
    .set("Content-Type", "application/json")
    .set("X-Signature-V2", signature)
    .send(JSON.stringify(event));
  assert.equal(duplicate.status, 202);
  assert.equal(duplicate.body.data.duplicate, true);
});

test("accepts exact-raw signatures and persists transaction and entity events", async () => {
  const event = {
    event_id: "transaction-event-1",
    transaction_id: "transaction-123",
    status: "approved",
    webhook_type: "transaction.created",
    timestamp: Math.floor(Date.now() / 1000),
    sensitive_data: "must-not-be-stored",
  };
  const rawBody = Buffer.from(JSON.stringify(event));
  const response = await request(app)
    .post("/api/v1/kyc/webhooks/didit")
    .set("Content-Type", "application/json")
    .set("X-Signature", signRaw(rawBody))
    .send(rawBody.toString("utf8"));

  assert.equal(response.status, 202);
  assert.equal(response.body.data.accepted, true);
  const transaction = providerEvents.get("transaction-event-1");
  assert.equal(transaction.eventType, "transaction.created");
  assert.equal(transaction.providerObjectId, "transaction-123");
  assert.equal(transaction.providerStatus, "approved");
  assert.equal("sensitive_data" in transaction, false);

  const entity = {
    event_id: "entity-event-1",
    user_id: "provider-user-123",
    status: "FLAGGED",
    webhook_type: "user.status.updated",
    timestamp: Math.floor(Date.now() / 1000),
    metadata: { display_name: "José 李" },
  };
  const entityResponse = await request(app)
    .post("/api/v1/kyc/webhooks/didit")
    .set("Content-Type", "application/json")
    .set("X-Signature-V2", signV2(entity))
    .send(JSON.stringify(entity));
  assert.equal(entityResponse.status, 202);
  assert.equal(providerEvents.get("entity-event-1").providerObjectId, "provider-user-123");

  const rotatedEvent = {
    event_id: "activity-event-1",
    activity_id: "activity-123",
    webhook_type: "activity.created",
    timestamp: Math.floor(Date.now() / 1000),
  };
  const rotatedResponse = await request(app)
    .post("/api/v1/kyc/webhooks/didit")
    .set("Content-Type", "application/json")
    .set("X-Signature-V2-Previous", signV2(
      rotatedEvent,
      process.env.DIDIT_WEBHOOK_SECRET_PREVIOUS
    ))
    .send(JSON.stringify(rotatedEvent));
  assert.equal(rotatedResponse.status, 202);
  assert.equal(providerEvents.get("activity-event-1").providerObjectId, "activity-123");
});

test("accepts a simple signature without trusting unsigned decision data", async () => {
  submissions.get("submission-1").documentVerificationStatus = null;
  const event = {
    event_id: "unsigned-event-id",
    session_id: "didit-session-1",
    status: "Approved",
    webhook_type: "status.updated",
    timestamp: Math.floor(Date.now() / 1000),
    decision: { id_verifications: [{ status: "Approved" }] },
  };
  const signedEnvelope = `${event.timestamp}:${event.session_id}:${event.status}:${event.webhook_type}`;
  const signature = crypto
    .createHmac("sha256", process.env.DIDIT_WEBHOOK_SECRET)
    .update(signedEnvelope)
    .digest("hex");
  const response = await request(app)
    .post("/api/v1/kyc/webhooks/didit")
    .set("Content-Type", "application/json")
    .set("X-Signature-Simple", signature)
    .send(JSON.stringify(event));

  assert.equal(response.status, 202);
  assert.equal(submissions.get("submission-1").providerStatus, "Approved");
  assert.equal(submissions.get("submission-1").documentVerificationStatus, null);
  assert.equal(providerEvents.has("unsigned-event-id"), false);
  assert.equal(
    [...providerEvents.keys()].some((eventId) => eventId.startsWith("simple-")),
    true
  );
});

test("rejects a stale signed body timestamp even when X-Timestamp is fresh", async () => {
  const event = {
    event_id: "event-stale",
    session_id: "didit-session-1",
    webhook_type: "status.updated",
    status: "Approved",
    timestamp: Math.floor(Date.now() / 1000) - 301,
  };
  const stale = await request(app)
    .post("/api/v1/kyc/webhooks/didit")
    .set("Content-Type", "application/json")
    .set("X-Timestamp", String(Math.floor(Date.now() / 1000)))
    .set("X-Signature-V2", signV2(event))
    .send(JSON.stringify(event));
  assert.equal(stale.status, 401);

  const freshEvent = {
    ...event,
    event_id: "event-invalid-signature",
    timestamp: Math.floor(Date.now() / 1000),
  };
  const invalidSignature = await request(app)
    .post("/api/v1/kyc/webhooks/didit")
    .set("Content-Type", "application/json")
    .set("X-Signature-V2", "00".repeat(32))
    .send(JSON.stringify(freshEvent));
  assert.equal(invalidSignature.status, 401);
});

test("verifies an exact-raw signature before parsing its JSON body", async () => {
  const response = await request(app)
    .post("/api/v1/kyc/webhooks/didit")
    .set("Content-Type", "application/json")
    .set("X-Signature", "00".repeat(32))
    .send("{");

  assert.equal(response.status, 401);
  assert.equal(response.body.message, "Webhook signature is invalid");
});

function postSignedV2(event) {
  return request(app)
    .post("/api/v1/kyc/webhooks/didit")
    .set("Content-Type", "application/json")
    .set("X-Signature-V2", signV2(event))
    .send(JSON.stringify(event));
}

test("a declined provider result enters review without approving the applicant or setting comparison", async () => {
  const base = Math.floor(Date.now() / 1000);
  const event = {
    event_id: "declined-event-1",
    session_id: "didit-session-declined",
    status: "Declined",
    webhook_type: "status.updated",
    timestamp: base,
    decision: {
      id_verifications: [{ status: "Declined" }],
      face_matches: [{ status: "Approved" }],
      liveness_checks: [{ status: "Approved" }],
    },
  };
  const response = await postSignedV2(event);

  assert.equal(response.status, 202);
  assert.equal(response.body.data.applied, true);
  const submission = submissions.get("submission-declined");
  assert.equal(submission.status, "PENDING_REVIEW");
  assert.notEqual(submission.status, "APPROVED");
  assert.equal(submission.providerStatus, "Declined");
  assert.equal(submission.documentVerificationStatus, "Declined");
  assert.equal(submission.dataComparisonStatus, null);
});

test("rejects an invalid submission status transition without applying provider data", async () => {
  const response = await postSignedV2({
    event_id: "invalid-transition-1",
    session_id: "didit-session-declined",
    status: "In Progress",
    webhook_type: "status.updated",
    timestamp: Math.floor(Date.now() / 1000) + 1,
    decision: { id_verifications: [{ status: "Approved" }] },
  });

  assert.equal(response.status, 202);
  assert.equal(response.body.data.applied, false);
  assert.equal(response.body.data.ignoredReason, "INVALID_TRANSITION");
  const submission = submissions.get("submission-declined");
  assert.equal(submission.status, "PENDING_REVIEW");
  assert.equal(submission.providerStatus, "Declined");
  assert.equal(submission.documentVerificationStatus, "Declined");
  assert.equal(auditEvents.at(-1).eventType, "DIDIT_RESULT_IGNORED");
});

test("ignores an out-of-order webhook that is older than the last applied event", async () => {
  const base = Math.floor(Date.now() / 1000);
  const newer = await postSignedV2({
    event_id: "order-new-1",
    session_id: "didit-session-order",
    status: "In Review",
    webhook_type: "status.updated",
    timestamp: base,
    decision: {
      id_verifications: [{ status: "In Review" }],
      face_matches: [{ status: "Approved" }],
      liveness_checks: [{ status: "Approved" }],
    },
  });
  assert.equal(newer.status, 202);
  assert.equal(newer.body.data.applied, true);

  const older = await postSignedV2({
    event_id: "order-old-1",
    session_id: "didit-session-order",
    status: "Approved",
    webhook_type: "status.updated",
    timestamp: base - 60,
    decision: {
      id_verifications: [{ status: "Approved" }],
      face_matches: [{ status: "Approved" }],
      liveness_checks: [{ status: "Approved" }],
    },
  });

  assert.equal(older.status, 202);
  assert.equal(older.body.data.applied, false);
  assert.equal(older.body.data.ignoredReason, "OUT_OF_ORDER_EVENT");
  const submission = submissions.get("submission-order");
  assert.equal(submission.providerStatus, "In Review");
  assert.equal(submission.status, "PENDING_REVIEW");
});

test("never changes a submission that already reached a terminal decision", async () => {
  const response = await postSignedV2({
    event_id: "terminal-event-1",
    session_id: "didit-session-terminal",
    status: "Declined",
    webhook_type: "status.updated",
    timestamp: Math.floor(Date.now() / 1000) + 2,
    decision: {
      id_verifications: [{ status: "Declined" }],
      face_matches: [{ status: "Declined" }],
      liveness_checks: [{ status: "Declined" }],
    },
  });

  assert.equal(response.status, 202);
  assert.equal(response.body.data.applied, false);
  assert.equal(response.body.data.ignoredReason, "TERMINAL_STATE");
  const submission = submissions.get("submission-terminal");
  assert.equal(submission.status, "APPROVED");
  assert.equal(submission.providerStatus, "Approved");
  assert.equal(submission.dataComparisonStatus, "MATCH");
});

test("a provider result cannot overwrite an existing applicant-data comparison", async () => {
  const response = await postSignedV2({
    event_id: "compare-event-1",
    session_id: "didit-session-compare",
    status: "Approved",
    webhook_type: "status.updated",
    timestamp: Math.floor(Date.now() / 1000) + 3,
    decision: {
      id_verifications: [{ status: "Approved" }],
      face_matches: [{ status: "Approved" }],
      liveness_checks: [{ status: "Approved" }],
    },
  });

  assert.equal(response.status, 202);
  assert.equal(response.body.data.applied, true);
  const submission = submissions.get("submission-compare");
  assert.equal(submission.status, "PENDING_REVIEW");
  assert.equal(submission.dataComparisonStatus, "MATCH");
  assert.deepEqual(submission.comparisonResults, [{ field: "firstName", status: "MATCH" }]);
});
