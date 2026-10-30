const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  "postgresql://auth:auth@localhost:5432/auth_password_reset_test?schema=public";
process.env.JWT_SECRET = "password-reset-test-secret-0123456789abcdef";
process.env.BCRYPT_ROUNDS = "4";
process.env.BREVO_API_KEY = "xkeysib-test-key";
process.env.LOG_LEVEL = "silent";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.ENABLE_API_DOCS = "false";
process.env.COOKIE_SECURE = "false";
process.env.SENSITIVE_AUTH_RATE_LIMIT_MAX = "100";
process.env.RATE_LIMIT_MAX = "1000";

const bcrypt = require("bcryptjs");

const PASSWORD_RESET_ACK =
  "If the account exists, a password reset code has been sent";

const users = new Map();
let otpCodes = [];
let sentEmails = [];
let sentAlerts = [];
let revokedForUsers = [];
let idCounter = 0;
let emailMode = "success";
let releaseDelivery = null;

const matchesWhere = (record, where) => {
  if (where.id && record.id !== where.id) return false;
  if (where.userId && record.userId !== where.userId) return false;
  if (where.email && record.email !== where.email) return false;
  if (where.purpose && record.purpose !== where.purpose) return false;
  if (where.consumedAt === null && record.consumedAt !== null) return false;
  if (where.expiresAt?.gt && !(record.expiresAt > where.expiresAt.gt)) return false;
  return true;
};

const fakePrisma = {
  $transaction: async (callback) => callback(fakePrisma),
  $queryRaw: async () => [{ "?column?": 1 }],
  user: {
    findUnique: async ({ where }) => {
      if (where.email) {
        return [...users.values()].find((user) => user.email === where.email) || null;
      }
      if (where.id) return users.get(where.id) || null;
      return null;
    },
    create: async ({ data }) => {
      const user = { id: `user-${++idCounter}`, role: "CUSTOMER", ...data };
      users.set(user.id, user);
      return user;
    },
    update: async ({ where, data }) => {
      const user = users.get(where.id);
      if (!user) throw new Error("User not found");
      Object.assign(user, data);
      return user;
    },
  },
  otpCode: {
    create: async ({ data }) => {
      const record = {
        id: `otp-${++idCounter}`,
        attempts: 0,
        consumedAt: null,
        createdAt: new Date(),
        ...data,
      };
      otpCodes.push(record);
      return record;
    },
    updateMany: async ({ where, data }) => {
      const matches = otpCodes.filter((record) => matchesWhere(record, where));
      for (const record of matches) Object.assign(record, data);
      return { count: matches.length };
    },
    findFirst: async ({ where }) => {
      const now = new Date();
      const matches = otpCodes
        .filter(
          (record) =>
            matchesWhere(record, where) &&
            record.consumedAt === null &&
            record.expiresAt > now
        )
        .sort((left, right) => right.createdAt - left.createdAt);
      return matches[0] || null;
    },
    update: async ({ where, data }) => {
      const record = otpCodes.find((item) => item.id === where.id);
      if (!record) throw new Error("OTP not found");
      if (data.attempts?.increment) record.attempts += data.attempts.increment;
      if (data.consumedAt) record.consumedAt = data.consumedAt;
      return { id: record.id, attempts: record.attempts };
    },
  },
  refreshToken: {
    create: async ({ data }) => ({ id: `rt-${++idCounter}`, revokedAt: null, ...data }),
    findUnique: async () => null,
    updateMany: async ({ where }) => {
      if (where.userId) revokedForUsers.push(where.userId);
      return { count: 1 };
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

const pino = require("pino");
const { Writable } = require("node:stream");

const logLines = [];
const logStream = new Writable({
  write(chunk, encoding, callback) {
    logLines.push(chunk.toString());
    callback();
  },
});
const fakeLogger = pino({ level: "info" }, logStream);

const loggerPath = require.resolve("../src/config/logger");
require.cache[loggerPath] = {
  id: loggerPath,
  filename: loggerPath,
  loaded: true,
  exports: fakeLogger,
};

const emailPath = require.resolve("../src/services/email.service");
require.cache[emailPath] = {
  id: emailPath,
  filename: emailPath,
  loaded: true,
  exports: {
    sendOtpEmail: async ({ to, otp, purpose }) => {
      sentEmails.push({ to, otp, purpose });
      if (emailMode === "fail") {
        throw new Error("Test mail transport unavailable");
      }
      if (emailMode === "blocked") {
        return new Promise((resolve) => {
          releaseDelivery = () => resolve({ delivered: true, transport: "api" });
        });
      }
      return { delivered: true, transport: "api" };
    },
    sendSecurityAlertEmail: async ({ to, via }) => {
      sentAlerts.push({ to, via });
      return { delivered: true, transport: "api" };
    },
  },
};

const app = require("../src/app");

let server;
let baseUrl;

test.before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  server.closeAllConnections?.();
});

test.beforeEach(() => {
  users.clear();
  otpCodes = [];
  sentEmails = [];
  sentAlerts = [];
  revokedForUsers = [];
  logLines.length = 0;
  emailMode = "success";
  releaseDelivery = null;
});

const request = (path, { method = "GET", headers = {}, body } = {}) => {
  const requestHeaders = { ...headers };
  if (body !== undefined) requestHeaders["Content-Type"] = "application/json";
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
};

const ensureUser = async (email, { verified = true } = {}) => {
  const user = {
    id: `user-${++idCounter}`,
    email,
    firstName: "Test",
    lastName: "User",
    username: email.split("@")[0],
    role: "CUSTOMER",
    isEmailVerified: verified,
    passwordHash: await bcrypt.hash("OldPassword123", 4),
    createdAt: new Date(),
  };
  users.set(user.id, user);
  return user;
};

const forgotPassword = (email) =>
  request("/api/v1/auth/forgot-password", {
    method: "POST",
    body: { email },
  });

const resetPassword = (email, otp, newPassword, confirmNewPassword = newPassword) =>
  request("/api/v1/auth/reset-password", {
    method: "POST",
    body: { email, otp, newPassword, confirmNewPassword },
  });

const lastOtpFor = (email) =>
  [...sentEmails].reverse().find((emailRecord) => emailRecord.to === email);

test("forgot password responds generically and issues a single reset code", async () => {
  const user = await ensureUser("reset1@example.test");

  const response = await forgotPassword(user.email);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.message, PASSWORD_RESET_ACK);

  const sent = lastOtpFor(user.email);
  assert.ok(sent);
  assert.equal(sent.purpose, "PASSWORD_RESET");
  assert.match(sent.otp, /^\d{6}$/);

  const records = otpCodes.filter((record) => record.userId === user.id);
  assert.equal(records.length, 1);
  assert.equal(records[0].purpose, "PASSWORD_RESET");
  assert.equal(records[0].consumedAt, null);
  assert.notEqual(records[0].codeHash, sent.otp, "OTP must be stored hashed");
  assert.ok(records[0].expiresAt > new Date());

  assert.ok(
    !logLines.some((line) => line.includes(sent.otp)),
    "OTP must never be logged in plaintext"
  );
});

test("forgot password does not reveal whether an account exists", async () => {
  const verified = await ensureUser("verified@example.test");
  const unverified = await ensureUser("unverified@example.test", { verified: false });

  const responses = await Promise.all([
    forgotPassword(verified.email),
    forgotPassword(unverified.email),
    forgotPassword("missing@example.test"),
  ]);

  for (const response of responses) {
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.message, PASSWORD_RESET_ACK);
  }

  const unknownRecords = otpCodes.filter(
    (record) => record.email === "missing@example.test"
  );
  assert.equal(unknownRecords.length, 0);
});

test("forgot password responds even when the mail provider is slow", async () => {
  const user = await ensureUser("slowmail@example.test");
  emailMode = "blocked";

  const timeout = new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), 2000);
    timer.unref?.();
  });

  try {
    const outcome = await Promise.race([
      forgotPassword(user.email).then(() => "responded"),
      timeout,
    ]);
    assert.equal(
      outcome,
      "responded",
      "password reset must not wait for mail delivery"
    );
    assert.equal(sentEmails.length, 1, "delivery should still be attempted");
  } finally {
    if (releaseDelivery) releaseDelivery();
  }
});

test("forgot password stays generic when delivery fails", async () => {
  const user = await ensureUser("failmail@example.test");
  emailMode = "fail";

  const response = await forgotPassword(user.email);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.message, PASSWORD_RESET_ACK);
});

test("reset password with valid OTP changes the password and consumes the code", async () => {
  const user = await ensureUser("reset2@example.test");

  await forgotPassword(user.email);
  const { otp } = lastOtpFor(user.email);

  const response = await resetPassword(user.email, otp, "NewPassword123");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.message, "Password has been reset");

  const updatedUser = users.get(user.id);
  assert.ok(await bcrypt.compare("NewPassword123", updatedUser.passwordHash));
  assert.equal(await bcrypt.compare("OldPassword123", updatedUser.passwordHash), false);

  const record = otpCodes.find((item) => item.userId === user.id);
  assert.ok(record.consumedAt, "OTP should be consumed after use");
  assert.ok(revokedForUsers.includes(user.id), "refresh sessions should be revoked");
  assert.deepEqual(
    sentAlerts,
    [{ to: user.email, via: "PASSWORD_RESET" }],
    "a security alert is emailed when alerts are enabled"
  );
});

test("reset password skips the security alert when the preference is disabled", async () => {
  const user = await ensureUser("reset-alerts-off@example.test");
  user.securityEmailAlerts = false;

  await forgotPassword(user.email);
  const { otp } = lastOtpFor(user.email);

  const response = await resetPassword(user.email, otp, "NewPassword123");
  assert.equal(response.status, 200);
  assert.deepEqual(sentAlerts, [], "no alert is sent when the user disabled them");
});

test("reset password rejects an invalid OTP and counts the attempt", async () => {
  const user = await ensureUser("reset3@example.test");

  await forgotPassword(user.email);
  const { otp } = lastOtpFor(user.email);
  const wrong = otp === "000000" ? "000001" : "000000";

  const response = await resetPassword(user.email, wrong, "NewPassword123");
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.success, false);
  assert.equal(body.code, "INVALID_OTP");
  assert.match(body.message, /invalid|expired/i);

  const record = otpCodes.find((item) => item.userId === user.id);
  assert.equal(record.attempts, 1);
  assert.equal(record.consumedAt, null);
  assert.ok(await bcrypt.compare("OldPassword123", users.get(user.id).passwordHash));
});

test("reset password rejects an expired OTP", async () => {
  const user = await ensureUser("reset4@example.test");

  await forgotPassword(user.email);
  const { otp } = lastOtpFor(user.email);
  const record = otpCodes.find((item) => item.userId === user.id);
  record.expiresAt = new Date(Date.now() - 1000);

  const response = await resetPassword(user.email, otp, "NewPassword123");
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, "INVALID_OTP");
  assert.ok(await bcrypt.compare("OldPassword123", users.get(user.id).passwordHash));
});

test("reset password cannot reuse a consumed OTP", async () => {
  const user = await ensureUser("reset5@example.test");

  await forgotPassword(user.email);
  const { otp } = lastOtpFor(user.email);

  const first = await resetPassword(user.email, otp, "NewPassword123");
  assert.equal(first.status, 200);

  const second = await resetPassword(user.email, otp, "AnotherPassword123");
  assert.equal(second.status, 400);
  const body = await second.json();
  assert.equal(body.code, "INVALID_OTP");
  assert.ok(await bcrypt.compare("NewPassword123", users.get(user.id).passwordHash));
});

test("reset password rejects weak passwords", async () => {
  const user = await ensureUser("reset6@example.test");

  await forgotPassword(user.email);
  const { otp } = lastOtpFor(user.email);

  for (const weakPassword of ["short", "12345678", "password", "NoNumbers", "nonumber123"]) {
    const response = await resetPassword(user.email, otp, weakPassword);
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "VALIDATION_ERROR");
    assert.ok(body.errors?.newPassword);
  }

  const record = otpCodes.find((item) => item.userId === user.id);
  assert.equal(record.consumedAt, null, "validation failures must not consume the OTP");
});

test("reset password invalidates the OTP after repeated wrong attempts", async () => {
  const user = await ensureUser("reset7@example.test");

  await forgotPassword(user.email);
  const { otp } = lastOtpFor(user.email);
  const wrong = otp === "000000" ? "000001" : "000000";

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await resetPassword(user.email, wrong, "NewPassword123");
    assert.equal(response.status, 400);
  }

  const record = otpCodes.find((item) => item.userId === user.id);
  assert.equal(record.attempts, 5);
  assert.ok(record.consumedAt, "exhausted OTP must be invalidated");

  const afterExhaustion = await resetPassword(user.email, otp, "NewPassword123");
  assert.equal(afterExhaustion.status, 400);
  const body = await afterExhaustion.json();
  assert.equal(body.code, "INVALID_OTP");
  assert.ok(await bcrypt.compare("OldPassword123", users.get(user.id).passwordHash));
});

test("concurrent forgot password requests do not create excessive active OTPs", async () => {
  const user = await ensureUser("reset8@example.test");

  const responses = await Promise.all(
    Array.from({ length: 5 }, () => forgotPassword(user.email))
  );
  for (const response of responses) assert.equal(response.status, 200);

  const activeOtps = otpCodes.filter(
    (record) =>
      record.userId === user.id &&
      record.consumedAt === null &&
      record.expiresAt > new Date()
  );
  assert.ok(activeOtps.length <= 2, `Too many active OTPs: ${activeOtps.length}`);
});
