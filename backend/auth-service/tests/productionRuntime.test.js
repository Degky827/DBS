const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");

process.env.NODE_ENV = "production";
process.env.DATABASE_URL =
  "postgresql://user:password@localhost:5432/auth_prod_test?schema=public";
process.env.JWT_SECRET =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.INTERNAL_SERVICE_KEY =
  "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
process.env.CORS_ORIGIN = "https://bank.example.com";
process.env.COOKIE_SECURE = "true";
process.env.REFRESH_COOKIE_PATH = "/api/auth";
process.env.ENABLE_HSTS = "true";
process.env.ENABLE_API_DOCS = "false";
process.env.TRUST_PROXY = "1";
process.env.BCRYPT_ROUNDS = "4";
process.env.LOG_LEVEL = "silent";
process.env.RATE_LIMIT_MAX = "1000";
process.env.LOGIN_RATE_LIMIT_MAX = "100";
process.env.BREVO_API_KEY = "xkeysib-test-key";

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const ORIGIN = "https://bank.example.com";
const PASSWORD = "Password123";
const users = new Map();
const refreshTokens = [];
let idCounter = 0;
let failUserLookup = false;

const fakePrisma = {
  $transaction: async (callback) => callback(fakePrisma),
  $queryRaw: async () => [{ "?column?": 1 }],
  user: {
    findUnique: async ({ where }) => {
      if (failUserLookup) {
        const error = new Error("connect ECONNREFUSED 10.0.0.5:5432");
        error.code = "P1001";
        throw error;
      }
      if (where.email) {
        return [...users.values()].find((user) => user.email === where.email) || null;
      }
      if (where.id) return users.get(where.id) || null;
      return null;
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
    update: async ({ where, data }) => {
      const record = refreshTokens.find((item) => item.id === where.id);
      Object.assign(record, data);
      return record;
    },
    updateMany: async ({ where, data }) => {
      const matches = refreshTokens.filter(
        (record) =>
          (!where.familyId || record.familyId === where.familyId) &&
          (!where.userId || record.userId === where.userId) &&
          (!where.id || record.id === where.id) &&
          (where.revokedAt !== null || record.revokedAt === null)
      );
      for (const record of matches) Object.assign(record, data);
      return { count: matches.length };
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

let server;
let baseUrl;

test.before(async () => {
  const user = {
    id: "prod-user-1",
    email: "prod@example.test",
    firstName: "Prod",
    lastName: "User",
    username: "produser",
    role: "CUSTOMER",
    isEmailVerified: true,
    passwordHash: await bcrypt.hash(PASSWORD, 4),
    createdAt: new Date(),
  };
  users.set(user.id, user);

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

const refreshCookie = (response) => {
  const raw = response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith("meridian_refresh="));
  if (!raw) return null;
  return {
    raw,
    value: decodeURIComponent(
      raw.slice("meridian_refresh=".length, raw.indexOf(";"))
    ),
  };
};

test("production responses enable HSTS and keep API headers locked down", async () => {
  const response = await request("/api/v1/health");
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("strict-transport-security") || "",
    /max-age=31536000/
  );
  assert.match(
    response.headers.get("content-security-policy") || "",
    /default-src 'none'/
  );
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("x-powered-by"), null);
});

test("Swagger is not served when production docs are disabled", async () => {
  const response = await request("/api/v1/docs/");
  const text = await response.text();

  assert.equal(response.status, 404);
  assert.doesNotMatch(text, /swagger/i);
  assert.doesNotMatch(text, /openapi/i);
});

test("production login sets a Secure HttpOnly cookie scoped to the proxy path", async () => {
  const response = await request("/api/v1/auth/login", {
    method: "POST",
    headers: { Origin: ORIGIN },
    body: { email: "prod@example.test", password: PASSWORD },
  });
  const body = await response.json();
  const cookie = refreshCookie(response);

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.ok(cookie);
  assert.match(cookie.raw, /Secure/i);
  assert.match(cookie.raw, /HttpOnly/i);
  assert.match(cookie.raw, /Path=\/api\/auth/i);
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    ORIGIN
  );

  const refreshed = await request("/api/v1/auth/refresh", {
    method: "POST",
    headers: { Origin: ORIGIN },
    cookie: cookie.value,
  });
  assert.equal(refreshed.status, 200);
  assert.match(refreshCookie(refreshed).raw, /Secure/i);
});

test("CORS rejects origins outside the production allowlist", async () => {
  const response = await request("/", {
    headers: { Origin: "http://localhost:5173" },
  });
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("internal failures return a generic message without stack or database details", async () => {
  const token = jwt.sign(
    {
      sub: "prod-user-1",
      email: "prod@example.test",
      role: "CUSTOMER",
      typ: "access",
    },
    process.env.JWT_SECRET,
    {
      algorithm: "HS256",
      expiresIn: "5m",
      issuer: "auth-service",
      audience: "banking-system",
    }
  );

  failUserLookup = true;
  const response = await request("/api/v1/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await response.text();
  failUserLookup = false;

  assert.equal(response.status, 500);
  const body = JSON.parse(text);
  assert.equal(body.message, "Internal server error");
  assert.equal(body.code, "INTERNAL_ERROR");
  assert.doesNotMatch(text, /ECONNREFUSED|10\.0\.0\.5|at /);
});
