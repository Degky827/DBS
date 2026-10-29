const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  "postgresql://auth:auth@localhost:5432/auth_preferences_test?schema=public";
process.env.JWT_SECRET = "auth-preferences-test-secret";
process.env.BCRYPT_ROUNDS = "4";
process.env.LOG_LEVEL = "silent";

const users = new Map([
  [
    "user-legacy",
    {
      id: "user-legacy",
      email: "legacy@example.test",
      passwordHash: "hash",
    },
  ],
  [
    "user-opted-out",
    {
      id: "user-opted-out",
      email: "optout@example.test",
      passwordHash: "hash",
      securityEmailAlerts: false,
    },
  ],
]);

const fakePrisma = {
  $transaction: async (callback) => callback(fakePrisma),
  user: {
    findUnique: async ({ where }) => (where.id ? users.get(where.id) || null : null),
    update: async ({ where, data }) => {
      const user = users.get(where.id);
      if (!user) throw new Error("User not found");
      Object.assign(user, data);
      return user;
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

const authService = require("../src/modules/auth/auth.service");
const {
  notificationPreferencesSchema,
} = require("../src/modules/auth/auth.validation");

test("preferences default to enabled for accounts without a stored value", async () => {
  const result = await authService.getNotificationPreferences("user-legacy");
  assert.deepEqual(result, { preferences: { securityEmailAlerts: true } });
});

test("preferences are persisted and returned after an update", async () => {
  const updated = await authService.updateNotificationPreferences("user-legacy", {
    securityEmailAlerts: false,
  });
  assert.deepEqual(updated, { preferences: { securityEmailAlerts: false } });
  assert.equal(users.get("user-legacy").securityEmailAlerts, false);

  const stored = await authService.getNotificationPreferences("user-legacy");
  assert.deepEqual(stored, { preferences: { securityEmailAlerts: false } });
});

test("an opted-out account reports disabled preferences", async () => {
  const result = await authService.getNotificationPreferences("user-opted-out");
  assert.deepEqual(result, { preferences: { securityEmailAlerts: false } });
});

test("unknown accounts cannot read preferences", async () => {
  await assert.rejects(
    authService.getNotificationPreferences("missing-user"),
    (error) => error.statusCode === 404 && error.code === "USER_NOT_FOUND"
  );
});

test("preference payloads reject non-booleans and unknown fields", () => {
  assert.equal(
    notificationPreferencesSchema.safeParse({ securityEmailAlerts: true }).success,
    true
  );
  assert.equal(
    notificationPreferencesSchema.safeParse({ securityEmailAlerts: "false" }).success,
    false
  );
  assert.equal(
    notificationPreferencesSchema.safeParse({
      securityEmailAlerts: true,
      smsAlerts: true,
    }).success,
    false
  );
});
