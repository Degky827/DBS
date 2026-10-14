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
const { hashPassword } = require("../src/utils/password.util");

const TEST_EMAIL = "integration.user@user.local";
const TEST_USERNAME = "integration_user";
const TEST_PASSWORD = "Integration@123";
const TEST_NEW_PASSWORD = "Changed@1234";

let accessToken;
let userId;

async function ensureTestUser() {
  const passwordHash = await hashPassword(TEST_PASSWORD);
  const existing = await prisma.userProfile.findUnique({
    where: { email: TEST_EMAIL },
  });

  if (existing) {
    await prisma.userProfile.update({
      where: { id: existing.id },
      data: {
        passwordHash,
        firstName: "Integration",
        lastName: "Tester",
        bio: null,
        city: null,
      },
    });
    await prisma.devSession.deleteMany({ where: { userId: existing.id } });
    return existing.id;
  }

  const created = await prisma.userProfile.create({
    data: {
      email: TEST_EMAIL,
      username: TEST_USERNAME,
      firstName: "Integration",
      lastName: "Tester",
      phoneNumber: "+15550199",
      dateOfBirth: new Date("1992-03-04"),
      gender: "other",
      passwordHash,
    },
  });
  return created.id;
}

before(async () => {
  try {
    await prisma.$connect();
    userId = await ensureTestUser();
  } catch (error) {
    console.error(
      "Skipping DB-backed assertions setup — is user_db reachable?",
      error.message
    );
    throw error;
  }
});

after(async () => {
  if (userId) {
    await prisma.devSession.deleteMany({ where: { userId } });
    await prisma.userProfile.deleteMany({ where: { email: TEST_EMAIL } });
  }
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

test("GET /api/v1/openapi.json returns spec", async () => {
  const res = await request(app).get("/api/v1/openapi.json");
  assert.equal(res.status, 200);
  assert.ok(res.body.paths["/api/v1/profile/me"]);
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
  const res = await request(app).get("/api/v1/profile/me");
  assert.equal(res.status, 401);
  assert.equal(res.body.code || res.body.success, false);
});

test("full profile + password change flow", async () => {
  const login = await request(app)
    .post("/api/v1/auth/dev-login")
    .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

  assert.equal(login.status, 200);
  accessToken = login.body.data.token;
  assert.ok(accessToken);
  assert.equal(login.body.data.user.id, userId);

  const me = await request(app)
    .get("/api/v1/profile/me")
    .set("Authorization", `Bearer ${accessToken}`);

  assert.equal(me.status, 200);
  assert.equal(me.body.data.user.email, TEST_EMAIL);
  assert.equal(me.body.data.user.passwordHash, undefined);
  assert.equal(Object.keys(me.body.data.user).includes("passwordHash"), false);

  const update = await request(app)
    .patch("/api/v1/profile/me")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ city: "Adama", bio: "Hello from tests" });

  assert.equal(update.status, 200);
  assert.equal(update.body.data.user.city, "Adama");
  assert.equal(update.body.data.user.bio, "Hello from tests");

  const rejected = await request(app)
    .patch("/api/v1/profile/me")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ role: "ADMIN", email: "evil@example.com" });

  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.success, false);

  const wrongCurrent = await request(app)
    .patch("/api/v1/profile/me/password")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({
      currentPassword: "NotThePass@1",
      newPassword: TEST_NEW_PASSWORD,
      confirmNewPassword: TEST_NEW_PASSWORD,
    });

  assert.equal(wrongCurrent.status, 401);

  const reuse = await request(app)
    .patch("/api/v1/profile/me/password")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({
      currentPassword: TEST_PASSWORD,
      newPassword: TEST_PASSWORD,
      confirmNewPassword: TEST_PASSWORD,
    });

  assert.equal(reuse.status, 400);

  const change = await request(app)
    .patch("/api/v1/profile/me/password")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({
      currentPassword: TEST_PASSWORD,
      newPassword: TEST_NEW_PASSWORD,
      confirmNewPassword: TEST_NEW_PASSWORD,
    });

  assert.equal(change.status, 200);
  assert.equal(change.body.success, true);

  const loginNew = await request(app)
    .post("/api/v1/auth/dev-login")
    .send({ email: TEST_EMAIL, password: TEST_NEW_PASSWORD });
  assert.equal(loginNew.status, 200);

  accessToken = loginNew.body.data.token;
});

test("dev-logout revokes session", async () => {
  const res = await request(app)
    .post("/api/v1/auth/dev-logout")
    .set("Authorization", `Bearer ${accessToken}`);
  assert.equal(res.status, 200);

  const me = await request(app)
    .get("/api/v1/profile/me")
    .set("Authorization", `Bearer ${accessToken}`);
  assert.equal(me.status, 401);
});
