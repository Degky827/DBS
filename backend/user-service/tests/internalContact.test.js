const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  "postgresql://test:test@localhost:5432/user_internal_contact_test?schema=public";
process.env.AUTH_MODE = "jwt";
process.env.JWT_SECRET = "user-internal-contact-secret-0123456789abcdef";
process.env.INTERNAL_SERVICE_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.LOG_LEVEL = "silent";
process.env.OUTBOX_ENABLED = "false";

const profiles = new Map();
const fakePrisma = {
  userProfile: {
    findUnique: async ({ where }) => profiles.get(where.id) || null,
  },
};

const databasePath = require.resolve("../src/config/database");
require.cache[databasePath] = {
  id: databasePath,
  filename: databasePath,
  loaded: true,
  exports: fakePrisma,
};

const request = require("supertest");
const app = require("../src/app");

const INTERNAL_KEY = process.env.INTERNAL_SERVICE_KEY;
const userId = "6f8a4f7e-7c2b-4a3c-9d1e-2b3c4d5e6f70";

profiles.set(userId, {
  id: userId,
  email: "Customer@Example.test",
  firstName: "Sample",
  lastName: "Customer",
  accountStatus: "ACTIVE",
  passwordHash: "must-not-leak",
  phoneNumber: "+251900000000",
});

const getContact = (id, key = INTERNAL_KEY) => {
  const call = request(app).get(`/api/v1/internal/users/${id}/contact`);
  return key === null ? call : call.set("X-Internal-Service-Key", key);
};

test("the contact endpoint rejects callers without the shared key", async () => {
  const missing = await getContact(userId, null);
  assert.equal(missing.status, 401);

  const wrong = await getContact(userId, "not-the-shared-key");
  assert.equal(wrong.status, 401);
});

test("the contact endpoint returns only fields a message needs", async () => {
  const response = await getContact(userId);
  assert.equal(response.status, 200);

  const { contact } = response.body.data;
  assert.deepEqual(Object.keys(contact).sort(), ["accountStatus", "email", "name", "userId"]);
  assert.equal(contact.email, "Customer@Example.test");
  assert.equal(contact.name, "Sample Customer");
  assert.equal(JSON.stringify(response.body).includes("passwordHash"), false);
  assert.equal(JSON.stringify(response.body).includes("phoneNumber"), false);
});

test("unknown ids are not found and malformed ids are rejected", async () => {
  const missing = await getContact("0b7f5c4c-1f0e-4d5c-8a9b-0c1d2e3f4a5b");
  assert.equal(missing.status, 404);

  const malformed = await getContact("not-a-uuid");
  assert.equal(malformed.status, 400);
});
