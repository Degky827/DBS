const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sharp = require("sharp");
const request = require("supertest");

const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "kyc-documents-"));
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://auth:auth@localhost:5432/kyc_test?schema=public";
process.env.JWT_SECRET = "kyc-document-test-secret";
process.env.JWT_ISSUER = "auth-service";
process.env.JWT_AUDIENCE = "banking-system";
process.env.ENABLE_API_DOCS = "false";
process.env.DIDIT_API_BASE_URL = "https://verification.didit.me";
process.env.STORAGE_DIR = storageDir;
process.env.STORAGE_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
process.env.MAX_FILE_SIZE_BYTES = "1024";

const documents = new Map();
const audits = [];
const submissionId = crypto.randomUUID();
const submissions = new Map([
  [submissionId, { id: submissionId, userId: "customer-owned", status: "DRAFT" }],
]);
const fakePrisma = {
  $transaction: async (callback) => callback(fakePrisma),
  kycSubmission: {
    findFirst: async ({ where }) => {
      const submission = submissions.get(where.id);
      return submission?.userId === where.userId ? submission : null;
    },
    findUnique: async ({ where }) => submissions.get(where.id) || null,
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
    create: async ({ data }) => {
      documents.set(data.id, { ...data, submission: submissions.get(data.submissionId) });
      return data;
    },
    findFirst: async ({ where }) => {
      const document = documents.get(where.id);
      if (!document || document.submission.userId !== where.submission.userId) return null;
      return document;
    },
    findUnique: async ({ where }) => documents.get(where.id) || null,
    findMany: async ({ where }) =>
      [...documents.values()].filter(
        (document) => document.submissionId === where.submissionId
      ),
    update: async ({ where, data }) => {
      const document = documents.get(where.id);
      Object.assign(document, data);
      return document;
    },
    delete: async ({ where }) => {
      const document = documents.get(where.id);
      documents.delete(where.id);
      return document;
    },
    deleteMany: async ({ where }) => {
      const document = documents.get(where.id);
      if (!document) return { count: 0 };
      const statusFilter = where.submission?.status;
      const statusMatches =
        typeof statusFilter === "string"
          ? document.submission.status === statusFilter
          : Array.isArray(statusFilter?.in)
            ? statusFilter.in.includes(document.submission.status)
            : true;
      if (!statusMatches) return { count: 0 };
      documents.delete(where.id);
      return { count: 1 };
    },
  },
  kycAuditEvent: {
    create: async ({ data }) => {
      audits.push(data);
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
const ocrProvider = require("../src/providers/tesseractOcrProvider");
const jwt = require("jsonwebtoken");
const token = jwt.sign(
  { sub: "customer-owned", typ: "access", role: "USER" },
  process.env.JWT_SECRET,
  { expiresIn: "5m", issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE }
);
const officerToken = jwt.sign(
  { sub: "officer-1", typ: "access", role: "VERIFICATION_OFFICER" },
  process.env.JWT_SECRET,
  { expiresIn: "5m", issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE }
);
let image;

test.before(async () => {
  image = await sharp({
    create: { width: 16, height: 16, channels: 3, background: "#ffffff" },
  }).jpeg().toBuffer();
});

test("image is encrypted, OCR fields are persisted encrypted, and only owner can retrieve it", async () => {
  const originalRecognize = ocrProvider.recognize;
  ocrProvider.recognize = async () => ({
    text: "First Name: Testia\nLast Name: Sample",
    confidence: 93.5,
  });

  try {
    const uploaded = await request(app)
      .post(`/api/v1/kyc/submissions/${submissionId}/documents`)
      .set("Authorization", `Bearer ${token}`)
      .field("documentType", "passport")
      .field("side", "front")
      .attach("document", image, { filename: "fictional.jpg", contentType: "image/jpeg" });

    assert.equal(uploaded.status, 201);
    const documentId = uploaded.body.data.id;
    const saved = documents.get(documentId);
    assert.notEqual(saved.ocrText, "First Name: Testia\nLast Name: Sample");
    assert.notEqual(
      saved.extractedData,
      JSON.stringify({ fields: uploaded.body.data.extractedData.fields })
    );
    const encryptedFile = fs.readFileSync(path.join(storageDir, saved.storageKey));
    assert.notDeepEqual(encryptedFile, image);

    const extracted = await request(app)
      .get(`/api/v1/kyc/documents/${documentId}`)
      .set("Authorization", `Bearer ${token}`);
    assert.equal(extracted.status, 200);
    assert.equal(extracted.body.data.ocrText, "First Name: Testia\nLast Name: Sample");
    assert.equal(extracted.body.data.extractedData.fields[0].needsCorrection, true);
    assert.equal("storageKey" in extracted.body.data, false);

    const content = await request(app)
      .get(`/api/v1/kyc/documents/${documentId}/content`)
      .set("Authorization", `Bearer ${token}`);
    assert.equal(content.status, 200);
    assert.equal(content.headers["cache-control"], "private, no-store");
    assert.deepEqual(content.body, image);

    const otherToken = jwt.sign(
      { sub: "customer-other", typ: "access" },
      process.env.JWT_SECRET,
      { expiresIn: "5m", issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE }
    );
    const unauthorized = await request(app)
      .get(`/api/v1/kyc/documents/${documentId}/content`)
      .set("Authorization", `Bearer ${otherToken}`);
    assert.equal(unauthorized.status, 404);
  } finally {
    ocrProvider.recognize = originalRecognize;
  }
});

test("upload rejects image data that does not match its declared image type", async () => {
  const response = await request(app)
    .post(`/api/v1/kyc/submissions/${submissionId}/documents`)
    .set("Authorization", `Bearer ${token}`)
    .field("documentType", "passport")
    .attach("document", Buffer.from("not an image"), {
      filename: "fictional.jpg",
      contentType: "image/jpeg",
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
});

test("upload rejects oversized files", async () => {
  const originalRecognize = ocrProvider.recognize;
  ocrProvider.recognize = async () => ({ text: "text", confidence: 50 });
  try {
    const oversized = Buffer.concat([image, Buffer.alloc(1025)]);
    const response = await request(app)
      .post(`/api/v1/kyc/submissions/${submissionId}/documents`)
      .set("Authorization", `Bearer ${token}`)
      .field("documentType", "passport")
      .attach("document", oversized, { filename: "large.jpg", contentType: "image/jpeg" });
    assert.equal(response.status, 413);
  } finally {
    ocrProvider.recognize = originalRecognize;
  }
});

test("OCR corrections retain original extracted text and record only changed field keys in audit", async () => {
  const originalRecognize = ocrProvider.recognize;
  ocrProvider.recognize = async () => ({
    text: "First Name: Testia",
    confidence: 90,
  });
  try {
    const uploaded = await request(app)
      .post(`/api/v1/kyc/submissions/${submissionId}/documents`)
      .set("Authorization", `Bearer ${token}`)
      .field("documentType", "passport")
      .attach("document", image, { filename: "fictional.jpg", contentType: "image/jpeg" });
    const documentId = uploaded.body.data.id;

    const corrected = await request(app)
      .patch(`/api/v1/kyc/documents/${documentId}/corrections`)
      .set("Authorization", `Bearer ${token}`)
      .send({ fields: [{ key: "field_1", value: "Testia" }] });
    assert.equal(corrected.status, 200);
    assert.equal(corrected.body.data.extractedData.fields[0].value, "Testia");
    assert.equal(corrected.body.data.extractedData.fields[0].correctedValue, "Testia");
    assert.equal(audits.at(-1).eventType, "OCR_FIELDS_CORRECTED");
    assert.deepEqual(audits.at(-1).payload.fieldKeys, ["field_1"]);
  } finally {
    ocrProvider.recognize = originalRecognize;
  }
});

test("officers can inspect evidence with private headers and every access is audited", async () => {
  const originalRecognize = ocrProvider.recognize;
  ocrProvider.recognize = async () => ({
    text: "First Name: Evidence",
    confidence: 88,
  });

  try {
    const uploaded = await request(app)
      .post(`/api/v1/kyc/submissions/${submissionId}/documents`)
      .set("Authorization", `Bearer ${token}`)
      .field("documentType", "passport")
      .attach("document", image, { filename: "fictional.jpg", contentType: "image/jpeg" });
    assert.equal(uploaded.status, 201);
    const documentId = uploaded.body.data.id;

    const ordinaryUser = await request(app)
      .get(`/api/v1/kyc/officer/submissions/${submissionId}/documents`)
      .set("Authorization", `Bearer ${token}`);
    assert.equal(ordinaryUser.status, 403);

    const listed = await request(app)
      .get(`/api/v1/kyc/officer/submissions/${submissionId}/documents`)
      .set("Authorization", `Bearer ${officerToken}`);
    assert.equal(listed.status, 200);
    assert.equal(
      listed.body.data.documents.some((document) => document.id === documentId),
      true
    );
    assert.equal("storageKey" in listed.body.data.documents[0], false);
    assert.equal(
      audits.some(
        (event) =>
          event.eventType === "OFFICER_DOCUMENTS_LISTED" &&
          event.actorId === "officer-1"
      ),
      true
    );

    const metadata = await request(app)
      .get(`/api/v1/kyc/officer/documents/${documentId}`)
      .set("Authorization", `Bearer ${officerToken}`);
    assert.equal(metadata.status, 200);
    assert.equal(metadata.body.data.extractedData.fields[0].value, "Evidence");
    assert.equal("storageKey" in metadata.body.data, false);
    assert.equal(
      audits.some((event) => event.eventType === "OFFICER_DOCUMENT_ACCESSED"),
      true
    );

    const content = await request(app)
      .get(`/api/v1/kyc/officer/documents/${documentId}/content`)
      .set("Authorization", `Bearer ${officerToken}`);
    assert.equal(content.status, 200);
    assert.equal(content.headers["cache-control"], "private, no-store");
    assert.match(content.headers["content-security-policy"], /sandbox/);
    assert.equal(content.headers["x-content-type-options"], "nosniff");
    assert.deepEqual(content.body, image);
    assert.equal(
      audits.some((event) => event.eventType === "OFFICER_DOCUMENT_CONTENT_ACCESSED"),
      true
    );

    const invalidId = await request(app)
      .get("/api/v1/kyc/officer/documents/not-a-uuid")
      .set("Authorization", `Bearer ${officerToken}`);
    assert.equal(invalidId.status, 400);

    const unknownId = await request(app)
      .get(`/api/v1/kyc/officer/documents/${crypto.randomUUID()}`)
      .set("Authorization", `Bearer ${officerToken}`);
    assert.equal(unknownId.status, 404);
  } finally {
    ocrProvider.recognize = originalRecognize;
  }
});

test("documents cannot be deleted or corrected after verification starts", async () => {
  const documentId = [...documents.keys()][0];
  const submission = submissions.get(submissionId);
  submission.status = "PENDING_REVIEW";

  const deleted = await request(app)
    .delete(`/api/v1/kyc/documents/${documentId}`)
    .set("Authorization", `Bearer ${token}`);
  assert.equal(deleted.status, 409);
  assert.equal(documents.has(documentId), true);

  const corrected = await request(app)
    .patch(`/api/v1/kyc/documents/${documentId}/corrections`)
    .set("Authorization", `Bearer ${token}`)
    .send({ fields: [{ key: "field_1", value: "Changed" }] });
  assert.equal(corrected.status, 409);

  submission.status = "DRAFT";
});

test.after(() => {
  fs.rmSync(storageDir, { recursive: true, force: true });
});
