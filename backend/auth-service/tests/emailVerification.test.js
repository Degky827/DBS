const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  "postgresql://auth:auth@localhost:5432/auth_email_test?schema=public";
process.env.JWT_SECRET = "auth-email-verification-test-secret";
process.env.BCRYPT_ROUNDS = "4";
process.env.BREVO_API_KEY = "xkeysib-test-key";
process.env.LOG_LEVEL = "silent";

const users = new Map();
let otps = [];
let idCounter = 0;
let emailMode = "success";
let sentEmails = [];
let logRecords = [];

const fakePrisma = {
  $transaction: async (callback) => callback(fakePrisma),
  user: {
    create: async ({ data }) => {
      const user = {
        id: `user-${++idCounter}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      users.set(user.id, user);
      return user;
    },
    findUnique: async ({ where }) => {
      if (where.email) {
        return [...users.values()].find((user) => user.email === where.email) || null;
      }
      if (where.username) {
        return (
          [...users.values()].find((user) => user.username === where.username) || null
        );
      }
      if (where.id) return users.get(where.id) || null;
      return null;
    },
    update: async ({ where, data }) => {
      const user = users.get(where.id);
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
      otps.push(record);
      return record;
    },
    updateMany: async ({ where, data }) => {
      const matches = otps.filter((record) => {
        if (where.id && record.id !== where.id) return false;
        if (where.email && record.email !== where.email) return false;
        if (where.purpose && record.purpose !== where.purpose) return false;
        if (where.consumedAt === null && record.consumedAt !== null) return false;
        return true;
      });
      for (const record of matches) Object.assign(record, data);
      return { count: matches.length };
    },
    findFirst: async ({ where }) => {
      const now = Date.now();
      const matches = otps
        .filter(
          (record) =>
            record.email === where.email &&
            record.purpose === where.purpose &&
            record.consumedAt === null &&
            record.expiresAt.getTime() > now
        )
        .sort((left, right) => right.createdAt - left.createdAt);
      return matches[0] || null;
    },
    update: async ({ where, data }) => {
      const record = otps.find((item) => item.id === where.id);
      if (data.attempts?.increment) {
        record.attempts += data.attempts.increment;
      }
      if (data.consumedAt) record.consumedAt = data.consumedAt;
      return { id: record.id, attempts: record.attempts };
    },
  },
  refreshToken: {
    create: async ({ data }) => ({ id: `rt-${++idCounter}`, ...data }),
    findFirst: async () => null,
    update: async ({ where, data }) => ({ id: where.id, ...data }),
    updateMany: async () => ({ count: 0 }),
  },
};

const databasePath = require.resolve("../src/config/database");
require.cache[databasePath] = {
  id: databasePath,
  filename: databasePath,
  loaded: true,
  exports: fakePrisma,
};

const loggerPath = require.resolve("../src/config/logger");
require.cache[loggerPath] = {
  id: loggerPath,
  filename: loggerPath,
  loaded: true,
  exports: {
    info: (payload, message) => logRecords.push({ level: "info", payload, message }),
    warn: (payload, message) => logRecords.push({ level: "warn", payload, message }),
    error: (payload, message) => logRecords.push({ level: "error", payload, message }),
    debug: (payload, message) => logRecords.push({ level: "debug", payload, message }),
  },
};

const emailPath = require.resolve("../src/services/email.service");
require.cache[emailPath] = {
  id: emailPath,
  filename: emailPath,
  loaded: true,
  exports: {
    sendOtpEmail: async ({ to, otp, purpose }) => {
      if (emailMode === "fail") {
        sentEmails.push({ to, otp, purpose, failed: true });
        throw new Error("Test mail transport unavailable");
      }
      if (emailMode === "not-configured") {
        sentEmails.push({ to, otp, purpose, failed: true });
        return { delivered: false };
      }
      sentEmails.push({ to, otp, purpose });
      return { delivered: true, transport: "api" };
    },
    sendSecurityAlertEmail: async () => ({ delivered: true, transport: "api" }),
  },
};

const authService = require("../src/modules/auth/auth.service");

const PASSWORD = "Password123";
const baseInput = {
  firstName: "Ada",
  lastName: "Lovelace",
  username: "ada_test",
  dateOfBirth: "1990-01-01",
  gender: "female",
  phoneNumber: "+1234567890",
  email: "ada@example.test",
  password: PASSWORD,
  confirmPassword: PASSWORD,
  securityQuestion: "What is your favorite color?",
  securityAnswer: "Blue",
  acceptedTerms: true,
};

test.beforeEach(() => {
  users.clear();
  otps = [];
  emailMode = "success";
  sentEmails = [];
  logRecords = [];
});

const registerUser = (overrides = {}) =>
  authService.register({ ...baseInput, ...overrides });

function lastOtp() {
  return sentEmails.at(-1).otp;
}

function logsContain(value) {
  return JSON.stringify(logRecords).includes(value);
}

test("registration creates an unverified account and emails an OTP without logging secrets", async () => {
  const result = await registerUser();

  assert.equal(result.user.isEmailVerified, false);
  assert.equal(result.verificationEmailSent, true);
  const user = [...users.values()][0];
  assert.equal(user.isEmailVerified, false);
  assert.equal(sentEmails.length, 1);
  assert.match(lastOtp(), /^\d{6}$/);
  assert.equal(logsContain(lastOtp()), false);
  assert.equal(logsContain(PASSWORD), false);
});

test("login before verification is rejected", async () => {
  await registerUser();

  await assert.rejects(
    () => authService.login({ email: baseInput.email, password: PASSWORD }),
    (error) => error.statusCode === 403 && error.code === "EMAIL_NOT_VERIFIED"
  );
});

test("successful verification marks the account verified and the OTP cannot be reused", async () => {
  await registerUser();
  const otp = lastOtp();

  const result = await authService.verifyEmail({ email: baseInput.email, otp });
  assert.equal(result.user.isEmailVerified, true);
  assert.equal([...users.values()][0].isEmailVerified, true);
  assert.ok(otps[0].consumedAt);

  await assert.rejects(
    () => authService.verifyEmail({ email: baseInput.email, otp }),
    (error) => error.statusCode === 400 && error.code === "INVALID_OTP"
  );
});

test("an incorrect OTP is rejected, counted, and never logged in plaintext", async () => {
  await registerUser();
  const correctOtp = lastOtp();
  const wrongOtp = correctOtp === "000000" ? "111111" : "000000";

  await assert.rejects(
    () => authService.verifyEmail({ email: baseInput.email, otp: wrongOtp }),
    (error) => error.statusCode === 400 && error.code === "INVALID_OTP"
  );
  assert.equal(otps[0].attempts, 1);
  assert.equal(users.size, 1);
  assert.equal([...users.values()][0].isEmailVerified, false);
  assert.equal(logsContain(correctOtp), false);
  assert.equal(logsContain(wrongOtp), false);
});

test("an expired OTP is rejected without verifying the account", async () => {
  await registerUser();
  const otp = lastOtp();
  otps[0].expiresAt = new Date(Date.now() - 1000);

  await assert.rejects(
    () => authService.verifyEmail({ email: baseInput.email, otp }),
    (error) => error.statusCode === 400 && error.code === "INVALID_OTP"
  );
  assert.equal([...users.values()][0].isEmailVerified, false);
});

test("repeated incorrect attempts exhaust and invalidate the OTP", async () => {
  await registerUser();
  const correctOtp = lastOtp();
  const wrongOtp = correctOtp === "000000" ? "111111" : "000000";

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(
      () => authService.verifyEmail({ email: baseInput.email, otp: wrongOtp }),
      (error) => error.statusCode === 400 && error.code === "INVALID_OTP"
    );
  }

  assert.equal(otps[0].attempts, 5);
  assert.ok(otps[0].consumedAt);

  await assert.rejects(
    () => authService.verifyEmail({ email: baseInput.email, otp: correctOtp }),
    (error) => error.statusCode === 400 && error.code === "INVALID_OTP"
  );
});

test("resending replaces the previous OTP and only the new code verifies", async () => {
  await registerUser();
  const firstOtp = lastOtp();

  await authService.resendOtp({ email: baseInput.email });
  assert.equal(sentEmails.length, 2);
  const secondOtp = lastOtp();
  assert.notEqual(firstOtp, secondOtp);
  assert.ok(otps[0].consumedAt);

  await assert.rejects(
    () => authService.verifyEmail({ email: baseInput.email, otp: firstOtp }),
    (error) => error.statusCode === 400 && error.code === "INVALID_OTP"
  );

  const verified = await authService.verifyEmail({
    email: baseInput.email,
    otp: secondOtp,
  });
  assert.equal(verified.user.isEmailVerified, true);
});

test("resending for an already verified account is acknowledged without sending", async () => {
  await registerUser();
  await authService.verifyEmail({ email: baseInput.email, otp: lastOtp() });
  const sentBefore = sentEmails.length;

  const result = await authService.resendOtp({ email: baseInput.email });

  assert.equal(
    result.message,
    "If the account exists, a new verification code has been sent"
  );
  assert.equal(sentEmails.length, sentBefore);
});

test("registration returns a safe error when the verification email cannot be sent", async () => {
  emailMode = "fail";
  await assert.rejects(
    () => registerUser(),
    (error) =>
      error.statusCode === 503 &&
      error.code === "EMAIL_DELIVERY_FAILED" &&
      !/\d{6}/.test(error.message)
  );

  const user = [...users.values()][0];
  assert.equal(user.isEmailVerified, false);
  const attemptedOtp = sentEmails[0].otp;
  assert.equal(logsContain(attemptedOtp), false);
});

test("resend returns a safe error when delivery fails and stays generic for unknown emails", async () => {
  await registerUser();
  emailMode = "fail";

  await assert.rejects(
    () => authService.resendOtp({ email: baseInput.email }),
    (error) =>
      error.statusCode === 503 &&
      error.code === "EMAIL_DELIVERY_FAILED" &&
      !/\d{6}/.test(error.message)
  );
  const attemptedOtp = sentEmails.at(-1).otp;
  assert.equal(logsContain(attemptedOtp), false);

  const unknown = await authService.resendOtp({ email: "missing@example.test" });
  assert.match(unknown.message, /If the account exists/);
});

test("verification enables login and issued tokens are never logged", async () => {
  await registerUser();
  await authService.verifyEmail({ email: baseInput.email, otp: lastOtp() });

  const result = await authService.login({
    email: baseInput.email,
    password: PASSWORD,
  });
  assert.equal(typeof result.accessToken, "string");
  assert.equal(typeof result.refreshToken, "string");
  assert.equal(logsContain(result.accessToken), false);
  assert.equal(logsContain(result.refreshToken), false);
  assert.equal(logsContain(PASSWORD), false);
});
