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
  }],
]);
const providerEvents = new Map();
const auditEvents = [];
const fakePrisma = {
  $transaction: async (callback) => callback(fakePrisma),
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
      Object.assign(submission, data);
      return { ...submission };
    },
  },
  kycProviderEvent: {
    findUnique: async ({ where }) => providerEvents.get(where.eventId) || null,
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
  assert.equal(submissions.get("submission-1").documentVerificationStatus, "Approved");
  assert.equal(submissions.get("submission-1").faceMatchStatus, "Approved");
  assert.equal(submissions.get("submission-1").livenessStatus, "Approved");

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
