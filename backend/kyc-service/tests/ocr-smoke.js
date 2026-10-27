const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const request = require("supertest");

const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "kyc-ocr-smoke-"));
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/kyc_test";
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.JWT_ISSUER = "auth-service";
process.env.JWT_AUDIENCE = "banking-system";
process.env.ENABLE_API_DOCS = "false";
process.env.STORAGE_DIR = storageDir;
process.env.STORAGE_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
process.env.MAX_FILE_SIZE_BYTES = "5242880";

const submission = {
  id: "ocr-smoke-submission",
  userId: "ocr-smoke-customer",
  status: "DRAFT",
};
const documents = new Map();
const fakePrisma = {
  $transaction: async (callback) => callback(fakePrisma),
  kycSubmission: {
    findFirst: async ({ where }) =>
      where.id === submission.id && where.userId === submission.userId
        ? { ...submission }
        : null,
  },
  kycDocument: {
    create: async ({ data }) => {
      documents.set(data.id, {
        ...data,
        submission: { ...submission },
        createdAt: new Date(),
      });
      return documents.get(data.id);
    },
    findFirst: async ({ where }) => {
      const document = documents.get(where.id);
      return document?.submission.userId === where.submission.userId ? document : null;
    },
  },
  kycAuditEvent: {
    create: async () => ({ id: crypto.randomUUID() }),
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
  { sub: submission.userId, typ: "access", role: "USER" },
  process.env.JWT_SECRET,
  { expiresIn: "5m", issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE }
);

async function run() {
  const sample = Buffer.from(
    '<svg width="1200" height="500" xmlns="http://www.w3.org/2000/svg">' +
      '<rect width="100%" height="100%" fill="white"/>' +
      '<text x="60" y="150" font-family="Arial" font-size="64">FIRST NAME: FICTITIOUS</text>' +
      '<text x="60" y="260" font-family="Arial" font-size="64">LAST NAME: SAMPLE</text>' +
      '<text x="60" y="370" font-family="Arial" font-size="64">DATE OF BIRTH: 1990-01-02</text>' +
      "</svg>"
  );
  const image = await sharp(sample).png().toBuffer();
  const response = await request(app)
    .post(`/api/v1/kyc/submissions/${submission.id}/documents`)
    .set("Authorization", `Bearer ${token}`)
    .field("documentType", "passport")
    .field("side", "front")
    .attach("document", image, {
      filename: "fictional-identity.png",
      contentType: "image/png",
    });

  assert.equal(response.status, 201, response.text);
  const normalizedText = response.body.data.ocrText
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ");
  const normalizedFields = response.body.data.extractedData.fields
    .map((field) => `${field.label} ${field.value}`)
    .join(" ")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ");

  for (const expected of [
    "FIRST NAME FICTITIOUS",
    "LAST NAME SAMPLE",
    "DATE OF BIRTH 1990 01 02",
  ]) {
    assert.ok(
      normalizedText.includes(expected) || normalizedFields.includes(expected),
      `OCR output did not include "${expected}"`
    );
  }
  assert.ok(
    Number.isFinite(response.body.data.ocrConfidence) &&
      response.body.data.ocrConfidence > 0,
    "OCR confidence should be a positive number"
  );

  const storedDocument = documents.get(response.body.data.id);
  assert.notEqual(storedDocument.ocrText, response.body.data.ocrText);
  console.log(
    `OCR upload smoke passed (confidence ${response.body.data.ocrConfidence}).`
  );
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await ocrProvider.terminate();
    } finally {
      fs.rmSync(storageDir, { recursive: true, force: true });
    }
  });
