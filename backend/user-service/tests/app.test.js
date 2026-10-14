const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.AUTH_MODE = "dev";
process.env.ENABLE_API_DOCS = "true";
process.env.AUTH_RATE_LIMIT_MAX = "1000";
process.env.RATE_LIMIT_MAX = "10000";

const app = require("../src/app");
const prisma = require("../src/config/database");
const userRepository = require("../src/repositories/user.repository");
const { hashPassword } = require("../src/utils/password.util");

const TEST_EMAIL = "integration.user@user.local";
const TEST_USERNAME = "integration_user";
const TEST_PASSWORD = "Integration@123";
const TEST_NEW_PASSWORD = "changedpass1234";

const OTHER_EMAIL = "other.user@user.local";
const OTHER_USERNAME = "other_user";
const OTHER_PASSWORD = "Other@12345";

let accessToken;
let userId;
let otherUserId;
let otherToken;

async function ensureUser({ email, username, password, firstName, lastName }) {
  const passwordHash = await hashPassword(password);
  const existing = await prisma.userProfile.findUnique({ where: { email } });

  if (existing) {
    await prisma.userProfile.update({
      where: { id: existing.id },
      data: { passwordHash, firstName, lastName, bio: null, city: null },
    });
    await prisma.devSession.deleteMany({ where: { userId: existing.id } });
    return existing.id;
  }

  const created = await prisma.userProfile.create({
    data: {
      email,
      username,
      firstName,
      lastName,
      phoneNumber: "+15550199",
      dateOfBirth: new Date("1992-03-04"),
      gender: "other",
      passwordHash,
    },
  });
  return created.id;
}

async function login(email, password) {
  const res = await request(app)
    .post("/api/v1/auth/dev-login")
    .send({ email, password });
  assert.equal(res.status, 200);
  return res.body.data.token;
}

before(async () => {
  await prisma.$connect();
  userId = await ensureUser({
    email: TEST_EMAIL,
    username: TEST_USERNAME,
    password: TEST_PASSWORD,
    firstName: "Integration",
    lastName: "Tester",
  });
  otherUserId = await ensureUser({
    email: OTHER_EMAIL,
    username: OTHER_USERNAME,
    password: OTHER_PASSWORD,
    firstName: "Other",
    lastName: "Account",
  });
});

after(async () => {
  await prisma.devSession.deleteMany({
    where: { userId: { in: [userId, otherUserId].filter(Boolean) } },
  });
  await prisma.userProfile.deleteMany({
    where: { email: { in: [TEST_EMAIL, OTHER_EMAIL] } },
  });
  await prisma.$disconnect();
});

test("GET / returns service metadata", async () => {
  const res = await request(app).get("/");
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.service, "user-service");
  assert.equal(res.body.data.authMode, "dev");
});

test("GET /api/v1/health returns healthy", async () => {
  const res = await request(app).get("/api/v1/health");
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, "healthy");
});

test("GET /api/v1/openapi.json returns users/me paths", async () => {
  const res = await request(app).get("/api/v1/openapi.json");
  assert.equal(res.status, 200);
  assert.ok(res.body.paths["/api/v1/users/me"]);
  assert.ok(res.body.paths["/api/v1/users/me/password"]);
});

test("unknown route returns 404 envelope", async () => {
  const res = await request(app).get("/api/v1/nope");
  assert.equal(res.status, 404);
  assert.equal(res.body.success, false);
});

test("dev-login rejects invalid credentials", async () => {
  const res = await request(app)
    .post("/api/v1/auth/dev-login")
    .send({ email: TEST_EMAIL, password: "WrongPass@1" });
  assert.equal(res.status, 401);
  assert.equal(res.body.success, false);
});

test("dev-login rejects invalid body", async () => {
  const res = await request(app)
    .post("/api/v1/auth/dev-login")
    .send({ email: "not-an-email" });
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
  assert.ok(res.body.errors);
});

test("profile requires authentication", async () => {
  const res = await request(app).get("/api/v1/users/me");
  assert.equal(res.status, 401);
  assert.equal(res.body.success, false);
});

test("invalid bearer token is rejected", async () => {
  const res = await request(app)
    .get("/api/v1/users/me")
    .set("Authorization", "Bearer not-a-real-token");
  assert.equal(res.status, 401);
  assert.equal(res.body.success, false);
});

test("full profile + password change flow", async () => {
  accessToken = await login(TEST_EMAIL, TEST_PASSWORD);

  const me = await request(app)
    .get("/api/v1/users/me")
    .set("Authorization", `Bearer ${accessToken}`);

  assert.equal(me.status, 200);
  assert.equal(me.body.data.user.email, TEST_EMAIL);
  assert.equal(me.body.data.user.id, userId);
  assert.equal(
    Object.prototype.hasOwnProperty.call(me.body.data.user, "passwordHash"),
    false
  );

  const update = await request(app)
    .patch("/api/v1/users/me")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ city: "Adama", bio: "Hello from tests" });

  assert.equal(update.status, 200);
  assert.equal(update.body.data.user.city, "Adama");
  assert.equal(update.body.data.user.bio, "Hello from tests");

  const rejected = await request(app)
    .patch("/api/v1/users/me")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ role: "ADMIN", email: "evil@example.com" });

  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.success, false);

  const wrongCurrent = await request(app)
    .patch("/api/v1/users/me/password")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({
      currentPassword: "NotThePass@1",
      newPassword: TEST_NEW_PASSWORD,
      confirmNewPassword: TEST_NEW_PASSWORD,
    });

  assert.equal(wrongCurrent.status, 401);

  const reuse = await request(app)
    .patch("/api/v1/users/me/password")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({
      currentPassword: TEST_PASSWORD,
      newPassword: TEST_PASSWORD,
      confirmNewPassword: TEST_PASSWORD,
    });

  assert.equal(reuse.status, 400);

  const weak = await request(app)
    .patch("/api/v1/users/me/password")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({
      currentPassword: TEST_PASSWORD,
      newPassword: "weak",
      confirmNewPassword: "weak",
    });

  assert.equal(weak.status, 400);

  const change = await request(app)
    .patch("/api/v1/users/me/password")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({
      currentPassword: TEST_PASSWORD,
      newPassword: TEST_NEW_PASSWORD,
      confirmNewPassword: TEST_NEW_PASSWORD,
    });

  assert.equal(change.status, 200);
  assert.equal(change.body.success, true);

  accessToken = await login(TEST_EMAIL, TEST_NEW_PASSWORD);
});

test("update profile rejects empty body and bad dates", async () => {
  const token = await login(TEST_EMAIL, TEST_NEW_PASSWORD);

  const empty = await request(app)
    .patch("/api/v1/users/me")
    .set("Authorization", `Bearer ${token}`)
    .send({});

  assert.equal(empty.status, 400);
  assert.equal(empty.body.success, false);

  const future = await request(app)
    .patch("/api/v1/users/me")
    .set("Authorization", `Bearer ${token}`)
    .send({ dateOfBirth: "2999-01-01" });

  assert.equal(future.status, 400);
  assert.ok(future.body.errors);

  const malformed = await request(app)
    .patch("/api/v1/users/me")
    .set("Authorization", `Bearer ${token}`)
    .send({ dateOfBirth: "not-a-date" });

  assert.equal(malformed.status, 400);

  const impossible = await request(app)
    .patch("/api/v1/users/me")
    .set("Authorization", `Bearer ${token}`)
    .send({ dateOfBirth: "2026-02-31" });

  assert.equal(impossible.status, 400);
});

test("update profile returns safe fields only", async () => {
  const token = await login(TEST_EMAIL, TEST_NEW_PASSWORD);

  const res = await request(app)
    .patch("/api/v1/users/me")
    .set("Authorization", `Bearer ${token}`)
    .send({ firstName: "Integration", city: "Adama" });

  assert.equal(res.status, 200);
  assert.equal(res.body.message, "Profile updated");
  assert.equal(res.body.data.user.city, "Adama");

  const banned = [
    "passwordHash",
    "password",
    "securityAnswerHash",
    "refreshToken",
    "tokenHash",
    "codeHash",
  ];
  for (const key of banned) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(res.body.data.user, key),
      false,
      `must not expose ${key}`
    );
  }

  const unchanged = await request(app)
    .patch("/api/v1/users/me")
    .set("Authorization", `Bearer ${token}`)
    .send({ city: "Adama" });

  assert.equal(unchanged.status, 200);
  assert.equal(unchanged.body.data.user.city, "Adama");
});

test("update profile returns 404 when user no longer exists", async () => {
  const token = await login(TEST_EMAIL, TEST_NEW_PASSWORD);
  const originalFind = userRepository.findById;
  userRepository.findById = async () => null;

  try {
    const res = await request(app)
      .patch("/api/v1/users/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ city: "Ghost" });

    assert.equal(res.status, 404);
    assert.equal(res.body.message, "Account not found");
  } finally {
    userRepository.findById = originalFind;
  }
});

test("change password enforces 12-char policy and strict body", async () => {
  const token = await login(TEST_EMAIL, TEST_NEW_PASSWORD);

  const tooShort = await request(app)
    .patch("/api/v1/users/me/password")
    .set("Authorization", `Bearer ${token}`)
    .send({
      currentPassword: TEST_NEW_PASSWORD,
      newPassword: "abcdefghijk",
      confirmNewPassword: "abcdefghijk",
    });

  assert.equal(tooShort.status, 400);
  assert.ok(
    JSON.stringify(tooShort.body.errors).includes("at least 12 characters")
  );

  const mismatch = await request(app)
    .patch("/api/v1/users/me/password")
    .set("Authorization", `Bearer ${token}`)
    .send({
      currentPassword: TEST_NEW_PASSWORD,
      newPassword: "BrandNewPass@123",
      confirmNewPassword: "DifferentPass@123",
    });

  assert.equal(mismatch.status, 400);

  const unexpected = await request(app)
    .patch("/api/v1/users/me/password")
    .set("Authorization", `Bearer ${token}`)
    .send({
      currentPassword: TEST_NEW_PASSWORD,
      newPassword: "BrandNewPass@123",
      confirmNewPassword: "BrandNewPass@123",
      userId: otherUserId,
    });

  assert.equal(unexpected.status, 400);

  const noAuth = await request(app)
    .patch("/api/v1/users/me/password")
    .send({
      currentPassword: "x",
      newPassword: "BrandNewPass@123",
      confirmNewPassword: "BrandNewPass@123",
    });

  assert.equal(noAuth.status, 401);
});

test("change password rejects same password without modifying hash", async () => {
  const token = await login(TEST_EMAIL, TEST_NEW_PASSWORD);

  const reuse = await request(app)
    .patch("/api/v1/users/me/password")
    .set("Authorization", `Bearer ${token}`)
    .send({
      currentPassword: TEST_NEW_PASSWORD,
      newPassword: TEST_NEW_PASSWORD,
      confirmNewPassword: TEST_NEW_PASSWORD,
    });

  assert.equal(reuse.status, 400);

  const stillWorks = await login(TEST_EMAIL, TEST_NEW_PASSWORD);
  assert.ok(stillWorks);
});

test("wrong current password does not change stored password", async () => {
  const token = await login(TEST_EMAIL, TEST_NEW_PASSWORD);

  const wrong = await request(app)
    .patch("/api/v1/users/me/password")
    .set("Authorization", `Bearer ${token}`)
    .send({
      currentPassword: "TotallyWrong@1",
      newPassword: "NeverSaved@1234",
      confirmNewPassword: "NeverSaved@1234",
    });

  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.success, false);
  assert.ok(!JSON.stringify(wrong.body).includes("NeverSaved@1234"));

  const oldStillWorks = await login(TEST_EMAIL, TEST_NEW_PASSWORD);
  assert.ok(oldStillWorks);

  const cannotLogin = await request(app)
    .post("/api/v1/auth/dev-login")
    .send({ email: TEST_EMAIL, password: "NeverSaved@1234" });
  assert.equal(cannotLogin.status, 401);
});

test("change password returns 404 when user no longer exists", async () => {
  const token = await login(TEST_EMAIL, TEST_NEW_PASSWORD);
  const original = userRepository.findById;
  userRepository.findById = async () => null;

  try {
    const res = await request(app)
      .patch("/api/v1/users/me/password")
      .set("Authorization", `Bearer ${token}`)
      .send({
        currentPassword: TEST_NEW_PASSWORD,
        newPassword: "BrandNewPass@123",
        confirmNewPassword: "BrandNewPass@123",
      });

    assert.equal(res.status, 404);
    assert.equal(res.body.message, "Account not found");
  } finally {
    userRepository.findById = original;
  }
});

test("change password DB failure returns sanitized 500 without false success", async () => {
  const token = await login(TEST_EMAIL, TEST_NEW_PASSWORD);
  const original = userRepository.updatePassword;
  userRepository.updatePassword = async () => {
    throw new Error("write failed dsn=postgres://user:pass@db");
  };

  try {
    const res = await request(app)
      .patch("/api/v1/users/me/password")
      .set("Authorization", `Bearer ${token}`)
      .send({
        currentPassword: TEST_NEW_PASSWORD,
        newPassword: "BrandNewPass@123",
        confirmNewPassword: "BrandNewPass@123",
      });

    assert.equal(res.status, 500);
    assert.equal(res.body.success, false);
    assert.equal(res.body.message, "Internal server error");
    assert.equal(String(res.body.message).includes("dsn"), false);
    assert.equal(res.body.stack, undefined);
  } finally {
    userRepository.updatePassword = original;
  }

  const oldStillWorks = await login(TEST_EMAIL, TEST_NEW_PASSWORD);
  assert.ok(oldStillWorks);
});

test("password change response never includes password material", async () => {
  const token = await login(TEST_EMAIL, TEST_NEW_PASSWORD);

  const change = await request(app)
    .patch("/api/v1/users/me/password")
    .set("Authorization", `Bearer ${token}`)
    .send({
      currentPassword: TEST_NEW_PASSWORD,
      newPassword: "AnotherNewPass@1",
      confirmNewPassword: "AnotherNewPass@1",
    });

  assert.equal(change.status, 200);
  const raw = JSON.stringify(change.body);
  assert.equal(raw.includes("AnotherNewPass@1"), false);
  assert.equal(raw.includes("passwordHash"), false);

  accessToken = await login(TEST_EMAIL, "AnotherNewPass@1");
  const changeBack = await request(app)
    .patch("/api/v1/users/me/password")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({
      currentPassword: "AnotherNewPass@1",
      newPassword: TEST_NEW_PASSWORD,
      confirmNewPassword: TEST_NEW_PASSWORD,
    });

  assert.equal(changeBack.status, 200);
});

test("request body cannot switch identity to another user", async () => {
  accessToken = await login(TEST_EMAIL, TEST_NEW_PASSWORD);
  otherToken = await login(OTHER_EMAIL, OTHER_PASSWORD);

  const spoofed = await request(app)
    .patch("/api/v1/users/me")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ userId: otherUserId, city: "Hacker City", id: otherUserId });

  assert.equal(spoofed.status, 400);
  assert.equal(spoofed.body.success, false);

  const otherMe = await request(app)
    .get("/api/v1/users/me")
    .set("Authorization", `Bearer ${otherToken}`);

  assert.equal(otherMe.status, 200);
  assert.equal(otherMe.body.data.user.id, otherUserId);
  assert.equal(otherMe.body.data.user.email, OTHER_EMAIL);
  assert.notEqual(otherMe.body.data.user.city, "Hacker City");
});

test("view profile returns safe fields only", async () => {
  const token = await login(TEST_EMAIL, TEST_NEW_PASSWORD);
  const res = await request(app)
    .get("/api/v1/users/me")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.message, "Profile fetched");

  const user = res.body.data.user;
  assert.equal(user.id, userId);
  assert.equal(user.email, TEST_EMAIL);
  assert.equal(user.username, TEST_USERNAME);
  assert.ok(user.firstName);
  assert.ok(user.lastName);
  assert.ok(user.phoneNumber);
  assert.ok(user.dateOfBirth);
  assert.ok(user.createdAt);
  assert.ok(user.updatedAt);

  const banned = [
    "passwordHash",
    "password",
    "securityAnswerHash",
    "refreshToken",
    "accessToken",
    "tokenHash",
    "codeHash",
  ];
  for (const key of banned) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(user, key),
      false,
      `must not expose ${key}`
    );
  }
});

test("view profile ignores client-supplied user id", async () => {
  const token = await login(TEST_EMAIL, TEST_NEW_PASSWORD);

  const viaQuery = await request(app)
    .get(`/api/v1/users/me?userId=${otherUserId}`)
    .set("Authorization", `Bearer ${token}`);

  assert.equal(viaQuery.status, 200);
  assert.equal(viaQuery.body.data.user.id, userId);
  assert.equal(viaQuery.body.data.user.email, TEST_EMAIL);

  const viaBody = await request(app)
    .get("/api/v1/users/me")
    .set("Authorization", `Bearer ${token}`)
    .send({ userId: otherUserId });

  assert.equal(viaBody.status, 200);
  assert.equal(viaBody.body.data.user.id, userId);
});

test("view profile returns 404 when user no longer exists", async () => {
  const token = await login(TEST_EMAIL, TEST_NEW_PASSWORD);
  const original = userRepository.findProfileById;
  userRepository.findProfileById = async () => null;

  try {
    const res = await request(app)
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${token}`);

    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
    assert.equal(res.body.message, "Account not found");
  } finally {
    userRepository.findProfileById = original;
  }
});

test("database failure returns sanitized 500", async () => {
  const token = await login(TEST_EMAIL, TEST_NEW_PASSWORD);
  const original = userRepository.findProfileById;
  userRepository.findProfileById = async () => {
    throw new Error("connection reset by peer secret-dsn=postgres://x");
  };

  try {
    const res = await request(app)
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${token}`);

    assert.equal(res.status, 500);
    assert.equal(res.body.success, false);
    assert.equal(res.body.message, "Internal server error");
    assert.equal(String(res.body.message).includes("secret-dsn"), false);
    assert.equal(res.body.stack, undefined);
  } finally {
    userRepository.findProfileById = original;
  }
});

test("dev-logout revokes session", async () => {
  const res = await request(app)
    .post("/api/v1/auth/dev-logout")
    .set("Authorization", `Bearer ${accessToken}`);
  assert.equal(res.status, 200);

  const me = await request(app)
    .get("/api/v1/users/me")
    .set("Authorization", `Bearer ${accessToken}`);
  assert.equal(me.status, 401);
});
