const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  "postgresql://auth:auth@localhost:5432/auth_mfa_test?schema=public";
process.env.JWT_SECRET = "auth-mfa-test-secret-0123456789abcdef";
process.env.BCRYPT_ROUNDS = "4";
process.env.LOG_LEVEL = "silent";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.ENABLE_API_DOCS = "false";
process.env.TRUST_PROXY = "0";
process.env.COOKIE_SECURE = "false";
process.env.REFRESH_COOKIE_PATH = "/api/v1/auth";
process.env.REFRESH_RATE_LIMIT_MAX = "100";
process.env.LOGIN_RATE_LIMIT_MAX = "100";
process.env.SENSITIVE_AUTH_RATE_LIMIT_MAX = "100";
process.env.RATE_LIMIT_MAX = "1000";
process.env.MFA_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.MFA_ISSUER = "Meridian Test Bank";
process.env.INTERNAL_SERVICE_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const {
  generateTotp,
  encryptMfaSecret,
} = require("../src/utils/mfa.util");

const TRUSTED_ORIGIN = "http://localhost:5173";
const PASSWORD = "Password123";

const users = new Map();
const refreshTokens = [];
const revokedAccessTokens = new Map();
let idCounter = 0;

const matchesWhere = (record, where) =>
  (!where.id || record.id === where.id) &&
  (!where.familyId || record.familyId === where.familyId) &&
  (!where.userId || record.userId === where.userId) &&
  (where.revokedAt !== null || record.revokedAt === null);

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
      Object.assign(user, data);
      return user;
    },
  },
  otpCode: {
    create: async ({ data }) => ({ id: `otp-${++idCounter}`, ...data }),
    updateMany: async () => ({ count: 0 }),
    findFirst: async () => null,
    update: async () => ({ attempts: 0 }),
  },
  refreshToken: {
    create: async ({ data }) => {
      const record = {
        id: `rt-${++idCounter}`,
        revokedAt: null,
        rotatedAt: null,
        replacedByTokenHash: null,
        createdAt: new Date(),
        ...data,
      };
      refreshTokens.push(record);
      return record;
    },
    findUnique: async ({ where }) => {
      const record = refreshTokens.find((item) => item.tokenHash === where.tokenHash);
      if (!record) return null;
      return { ...record, user: users.get(record.userId) || null };
    },
    findFirst: async ({ where }) => {
      const now = new Date();
      return (
        refreshTokens.find(
          (record) =>
            record.familyId === where.familyId &&
            record.revokedAt === null &&
            record.expiresAt > now &&
            (!record.familyExpiresAt || record.familyExpiresAt > now)
        ) || null
      );
    },
    update: async ({ where, data }) => {
      const record = refreshTokens.find((item) => item.id === where.id);
      Object.assign(record, data);
      return record;
    },
    updateMany: async ({ where, data }) => {
      const matches = refreshTokens.filter((record) => matchesWhere(record, where));
      for (const record of matches) Object.assign(record, data);
      return { count: matches.length };
    },
  },
  accessTokenRevocation: {
    findUnique: async ({ where }) => revokedAccessTokens.get(where.jti) || null,
    upsert: async ({ where, create }) => {
      if (!revokedAccessTokens.has(where.jti)) {
        revokedAccessTokens.set(where.jti, {
          id: `revoked-${++idCounter}`,
          ...create,
        });
      }
      return revokedAccessTokens.get(where.jti);
    },
    deleteMany: async () => ({ count: 0 }),
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

let server;
let baseUrl;

test.before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
});

const request = (path, { method = "GET", headers = {}, body, cookie } = {}) => {
  const requestHeaders = { ...headers };
  if (body !== undefined) requestHeaders["Content-Type"] = "application/json";
  if (cookie !== undefined) {
    requestHeaders.Cookie = `meridian_refresh=${encodeURIComponent(cookie)}`;
  }
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
};

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

const ensureUser = async (email, overrides = {}) => {
  const existing = [...users.values()].find((user) => user.email === email);
  if (existing) return existing;
  const user = {
    id: `user-${++idCounter}`,
    email,
    firstName: "Ada",
    lastName: "Lovelace",
    username: email.split("@")[0],
    role: "CUSTOMER",
    status: "ACTIVE",
    isEmailVerified: true,
    mfaEnabled: false,
    mfaRecoveryCodeHashes: [],
    passwordHash: await bcrypt.hash(PASSWORD, 4),
    createdAt: new Date(),
    ...overrides,
  };
  users.set(user.id, user);
  return user;
};

const login = async (email, password = PASSWORD) => {
  await ensureUser(email);
  const response = await request("/api/v1/auth/login", {
    method: "POST",
    headers: { Origin: TRUSTED_ORIGIN },
    body: { email, password },
  });
  return { response, body: await response.json() };
};

const loginWithMfa = async (email) => {
  const { response, body } = await login(email);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.mfaRequired, true);
  return body.data.mfaToken;
};

const verifyMfa = (mfaToken, code) =>
  request("/api/v1/auth/mfa/verify", {
    method: "POST",
    headers: { Origin: TRUSTED_ORIGIN },
    body: { mfaToken, code },
  });

test("login with MFA enabled defers session creation to the second factor", async () => {
  const user = await ensureUser("mfa-login@example.test", {
    mfaEnabled: true,
    mfaSecretEncrypted: encryptMfaSecret("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"),
  });

  const { response, body } = await login(user.email);

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.mfaRequired, true);
  assert.equal(typeof body.data.mfaToken, "string");
  assert.equal(body.data.accessToken, undefined);
  assert.equal(response.headers.getSetCookie().length, 0);
  assert.equal(refreshTokens.filter((token) => token.userId === user.id).length, 0);
});

test("a valid authenticator code completes the MFA login exactly once", async () => {
  const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
  await ensureUser("mfa-verify@example.test", {
    mfaEnabled: true,
    mfaSecretEncrypted: encryptMfaSecret(secret),
  });

  const mfaToken = await loginWithMfa("mfa-verify@example.test");
  const response = await verifyMfa(mfaToken, generateTotp(secret));
  const body = await response.json();

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.user.email, "mfa-verify@example.test");
  assert.equal(body.data.user.mfaEnabled, true);

  const claims = jwt.verify(body.data.accessToken, process.env.JWT_SECRET, {
    issuer: "auth-service",
    audience: "banking-system",
    algorithms: ["HS256"],
  });
  assert.deepEqual(claims.amr, ["pwd", "mfa"]);
  assert.equal(typeof claims.stepUpAt, "number");

  const cookie = response.headers
    .getSetCookie()
    .find((item) => item.startsWith("meridian_refresh="));
  assert.ok(cookie, "refresh cookie should be set after MFA");

  const replay = await verifyMfa(mfaToken, generateTotp(secret));
  const replayBody = await replay.json();
  assert.equal(replay.status, 401, JSON.stringify(replayBody));
  assert.equal(replayBody.code, "MFA_CHALLENGE_USED");
});

test("an invalid authenticator code does not start a session", async () => {
  const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
  const user = await ensureUser("mfa-invalid@example.test", {
    mfaEnabled: true,
    mfaSecretEncrypted: encryptMfaSecret(secret),
  });

  const mfaToken = await loginWithMfa("mfa-invalid@example.test");
  const response = await verifyMfa(mfaToken, "000000");

  assert.equal(response.status, 401);
  assert.equal(
    refreshTokens.filter((token) => token.userId === user.id).length,
    0
  );
});

test("enrollment returns a provisioning URI and single-use recovery codes", async () => {
  await ensureUser("mfa-enroll@example.test");
  const loginResponse = await login("mfa-enroll@example.test");
  const accessToken = loginResponse.body.data.accessToken;

  const setup = await request("/api/v1/auth/mfa/setup", {
    method: "POST",
    headers: bearer(accessToken),
    body: {},
  });
  const setupBody = await setup.json();
  assert.equal(setup.status, 200, JSON.stringify(setupBody));
  assert.match(setupBody.data.otpauthUri, /^otpauth:\/\/totp\//);
  assert.equal(setupBody.data.issuer, "Meridian Test Bank");

  const secret = setupBody.data.secret;
  const confirm = await request("/api/v1/auth/mfa/setup/confirm", {
    method: "POST",
    headers: bearer(accessToken),
    body: { code: generateTotp(secret) },
  });
  const confirmBody = await confirm.json();
  assert.equal(confirm.status, 200, JSON.stringify(confirmBody));
  assert.equal(confirmBody.data.enabled, true);
  assert.equal(confirmBody.data.recoveryCodes.length, 10);

  const status = await request("/api/v1/auth/mfa", {
    headers: bearer(accessToken),
  });
  const statusBody = await status.json();
  assert.equal(statusBody.data.enabled, true);
  assert.equal(statusBody.data.recoveryCodesRemaining, 10);
});

test("a recovery code can replace the authenticator once", async () => {
  const user = await ensureUser("mfa-recovery@example.test");
  const { hashRecoveryCode } = require("../src/utils/mfa.util");
  user.mfaEnabled = true;
  user.mfaSecretEncrypted = encryptMfaSecret(
    "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"
  );
  user.mfaRecoveryCodeHashes = [hashRecoveryCode("ABCDE-FGHIJ")];

  const firstChallenge = await loginWithMfa(user.email);
  const first = await request("/api/v1/auth/mfa/verify", {
    method: "POST",
    headers: { Origin: TRUSTED_ORIGIN },
    body: { mfaToken: firstChallenge, recoveryCode: "ABCDE-FGHIJ" },
  });
  assert.equal(first.status, 200);
  assert.equal(user.mfaRecoveryCodeHashes.length, 0);

  const secondChallenge = await loginWithMfa(user.email);
  const second = await request("/api/v1/auth/mfa/verify", {
    method: "POST",
    headers: { Origin: TRUSTED_ORIGIN },
    body: { mfaToken: secondChallenge, recoveryCode: "ABCDE-FGHIJ" },
  });
  assert.equal(second.status, 401);
});

test("step-up re-verifies the factor and refreshes stepUpAt", async () => {
  const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
  await ensureUser("mfa-stepup@example.test", {
    mfaEnabled: true,
    mfaSecretEncrypted: encryptMfaSecret(secret),
  });

  const mfaToken = await loginWithMfa("mfa-stepup@example.test");
  const verified = await verifyMfa(mfaToken, generateTotp(secret));
  const verifiedBody = await verified.json();

  await new Promise((resolve) => setTimeout(resolve, 1100));

  const response = await request("/api/v1/auth/mfa/step-up", {
    method: "POST",
    headers: bearer(verifiedBody.data.accessToken),
    body: { code: generateTotp(secret) },
  });
  const body = await response.json();

  assert.equal(response.status, 200, JSON.stringify(body));
  const claims = jwt.verify(body.data.accessToken, process.env.JWT_SECRET, {
    issuer: "auth-service",
    audience: "banking-system",
    algorithms: ["HS256"],
  });
  assert.ok(claims.stepUpAt >= claims.iat * 1000);
  assert.ok(new Date(body.data.stepUpExpiresAt).getTime() > Date.now());

  const invalid = await request("/api/v1/auth/mfa/step-up", {
    method: "POST",
    headers: bearer(verifiedBody.data.accessToken),
    body: { code: "000000" },
  });
  assert.equal(invalid.status, 401);
});

test("suspended and closed accounts cannot authenticate; frozen accounts can", async () => {
  const suspended = await ensureUser("mfa-suspended@example.test", {
    status: "SUSPENDED",
  });
  const suspendedLogin = await login(suspended.email);
  assert.equal(suspendedLogin.response.status, 403);
  assert.equal(suspendedLogin.body.code, "ACCOUNT_SUSPENDED");

  const closed = await ensureUser("mfa-closed@example.test", { status: "CLOSED" });
  const closedLogin = await login(closed.email);
  assert.equal(closedLogin.response.status, 403);
  assert.equal(closedLogin.body.code, "ACCOUNT_CLOSED");

  const frozen = await ensureUser("mfa-frozen@example.test", { status: "FROZEN" });
  const frozenLogin = await login(frozen.email);
  assert.equal(frozenLogin.response.status, 200, JSON.stringify(frozenLogin.body));
  assert.equal(frozenLogin.body.data.user.status, "FROZEN");
});

test("internal status updates revoke sessions and enforce transitions", async () => {
  const user = await ensureUser("mfa-status@example.test");
  const loginResponse = await login(user.email);
  assert.equal(loginResponse.response.status, 200);

  const internalHeaders = {
    "X-Internal-Service-Key": process.env.INTERNAL_SERVICE_KEY,
  };

  const freeze = await request("/api/v1/internal/users/status", {
    method: "POST",
    headers: internalHeaders,
    body: { email: user.email, status: "FROZEN", reason: "Suspicious activity review" },
  });
  const freezeBody = await freeze.json();
  assert.equal(freeze.status, 200, JSON.stringify(freezeBody));
  assert.equal(freezeBody.data.status, "FROZEN");
  assert.equal(
    refreshTokens.filter((token) => token.userId === user.id && token.revokedAt).length,
    1
  );

  const closed = await request("/api/v1/internal/users/status", {
    method: "POST",
    headers: internalHeaders,
    body: { email: user.email, status: "CLOSED", reason: "Customer request" },
  });
  assert.equal(closed.status, 200);

  const reopen = await request("/api/v1/internal/users/status", {
    method: "POST",
    headers: internalHeaders,
    body: { email: user.email, status: "ACTIVE" },
  });
  const reopenBody = await reopen.json();
  assert.equal(reopen.status, 409, JSON.stringify(reopenBody));
  assert.equal(reopenBody.code, "INVALID_STATUS_TRANSITION");
});

test("internal close requires the account password", async () => {
  const user = await ensureUser("mfa-close@example.test");
  const internalHeaders = {
    "X-Internal-Service-Key": process.env.INTERNAL_SERVICE_KEY,
  };

  const rejected = await request("/api/v1/internal/users/close", {
    method: "POST",
    headers: internalHeaders,
    body: { email: user.email, password: "WrongPassword123" },
  });
  assert.equal(rejected.status, 401);
  assert.equal(user.status, "ACTIVE");

  const accepted = await request("/api/v1/internal/users/close", {
    method: "POST",
    headers: internalHeaders,
    body: { email: user.email, password: PASSWORD, reason: "Customer request" },
  });
  const body = await accepted.json();
  assert.equal(accepted.status, 200, JSON.stringify(body));
  assert.equal(user.status, "CLOSED");
});
