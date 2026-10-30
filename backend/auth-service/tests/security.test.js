const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  "postgresql://auth:auth@localhost:5432/auth_security_test?schema=public";
process.env.JWT_SECRET = "auth-security-test-secret-0123456789abcdef";
process.env.BCRYPT_ROUNDS = "4";
process.env.LOG_LEVEL = "silent";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.ENABLE_API_DOCS = "false";
process.env.TRUST_PROXY = "0";
process.env.COOKIE_SECURE = "false";
process.env.REFRESH_COOKIE_PATH = "/api/v1/auth";
process.env.REFRESH_RATE_LIMIT_MAX = "100";
process.env.LOGIN_RATE_LIMIT_MAX = "3";
process.env.SENSITIVE_AUTH_RATE_LIMIT_MAX = "100";
process.env.RATE_LIMIT_MAX = "1000";

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const TRUSTED_ORIGIN = "http://localhost:5173";
const PASSWORD = "Password123";

const users = new Map();
const refreshTokens = [];
let idCounter = 0;
let readinessQueries = 0;

const matchesWhere = (record, where) =>
  (!where.id || record.id === where.id) &&
  (!where.familyId || record.familyId === where.familyId) &&
  (!where.userId || record.userId === where.userId) &&
  (where.revokedAt !== null || record.revokedAt === null);

const fakePrisma = {
  $transaction: async (callback) => callback(fakePrisma),
  $queryRaw: async () => {
    readinessQueries += 1;
    return [{ "?column?": 1 }];
  },
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

const ensureUser = async (email) => {
  const existing = [...users.values()].find((user) => user.email === email);
  if (existing) return existing;
  const user = {
    id: `user-${++idCounter}`,
    email,
    firstName: "Ada",
    lastName: "Lovelace",
    username: email.split("@")[0],
    role: "CUSTOMER",
    isEmailVerified: true,
    passwordHash: await bcrypt.hash(PASSWORD, 4),
    createdAt: new Date(),
  };
  users.set(user.id, user);
  return user;
};

const login = async (email) => {
  await ensureUser(email);
  const response = await request("/api/v1/auth/login", {
    method: "POST",
    headers: { Origin: TRUSTED_ORIGIN },
    body: { email, password: PASSWORD },
  });
  const body = await response.json();
  const cookie = refreshCookie(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  return { response, body, cookie };
};

const refresh = (cookie, origin = TRUSTED_ORIGIN) =>
  request("/api/v1/auth/refresh", {
    method: "POST",
    headers: origin === null ? {} : { Origin: origin },
    cookie,
  });

test("login returns a short-lived access token and an HttpOnly refresh cookie", async () => {
  const { response, body, cookie } = await login("one@example.test");

  assert.equal(body.success, true);
  assert.equal(typeof body.data.accessToken, "string");
  assert.equal(body.data.refreshToken, undefined);
  assert.equal(body.data.user.email, "one@example.test");
  assert.equal(response.headers.get("cache-control"), "no-store");

  assert.ok(cookie);
  assert.match(cookie.raw, /HttpOnly/i);
  assert.match(cookie.raw, /SameSite=Lax/i);
  assert.match(cookie.raw, /Path=\/api\/v1\/auth/i);
  assert.match(cookie.raw, /Max-Age=604800/i);
  assert.doesNotMatch(cookie.raw, /Secure/i);
});

test("refresh rotates the cookie and issues a new access token", async () => {
  const first = await login("two@example.test");
  const response = await refresh(first.cookie.value);
  const body = await response.json();
  const rotated = refreshCookie(response);

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.ok(rotated);
  assert.notEqual(rotated.value, first.cookie.value);
  assert.equal(typeof body.data.accessToken, "string");
  assert.equal(body.data.refreshToken, undefined);

  const claims = jwt.verify(body.data.accessToken, process.env.JWT_SECRET, {
    issuer: "auth-service",
    audience: "banking-system",
    algorithms: ["HS256"],
  });
  assert.equal(claims.typ, "access");
  assert.equal(claims.email, "two@example.test");
});

test("concurrent refresh returns one rotation and one retryable race", async () => {
  const session = await login("three@example.test");
  const responses = await Promise.all([
    refresh(session.cookie.value),
    refresh(session.cookie.value),
  ]);
  const statuses = responses.map((response) => response.status).sort();
  assert.deepEqual(statuses, [200, 409]);

  const race = responses.find((response) => response.status === 409);
  const raceBody = await race.json();
  assert.equal(raceBody.code, "REFRESH_RACE");
  assert.equal(refreshCookie(race), null, "a race must not clear the cookie");

  const winner = responses.find((response) => response.status === 200);
  const winnerCookie = refreshCookie(winner);
  const retry = await refresh(winnerCookie.value);
  assert.equal(retry.status, 200);
});

test("refresh reuse outside the grace window revokes the token family", async () => {
  const session = await login("four@example.test");
  const rotated = await refresh(session.cookie.value);
  const successor = refreshCookie(rotated).value;

  const four = [...users.values()].find((user) => user.email === "four@example.test");
  const oldRecord = refreshTokens.find(
    (record) => record.rotatedAt && record.userId === four.id
  );
  oldRecord.rotatedAt = new Date(Date.now() - 5 * 60 * 1000);

  const reuse = await refresh(session.cookie.value);
  const reuseBody = await reuse.json();
  assert.equal(reuse.status, 401);
  assert.equal(reuseBody.code, "REFRESH_TOKEN_REUSED");
  assert.ok(refreshCookie(reuse), "reuse should clear the browser cookie");

  const successorAttempt = await refresh(successor);
  assert.equal(successorAttempt.status, 401);

  const family = refreshTokens.filter((record) => record.familyId === oldRecord.familyId);
  assert.ok(family.length >= 2);
  assert.ok(family.every((record) => record.revokedAt));
});

test("logout revokes the family and clears the cookie", async () => {
  const session = await login("five@example.test");
  const response = await request("/api/v1/auth/logout", {
    method: "POST",
    headers: { Origin: TRUSTED_ORIGIN },
    cookie: session.cookie.value,
  });
  const body = await response.json();

  assert.equal(response.status, 200, JSON.stringify(body));
  const cleared = refreshCookie(response);
  assert.ok(cleared);
  assert.match(cleared.raw, /Max-Age=0/i);

  const afterLogout = await refresh(session.cookie.value);
  assert.equal(afterLogout.status, 401);
});

test("missing, malformed, and expired refresh tokens are rejected", async () => {
  const missing = await refresh(undefined);
  const missingBody = await missing.json();
  assert.equal(missing.status, 401);
  assert.equal(missingBody.code, "REFRESH_TOKEN_MISSING");
  assert.ok(refreshCookie(missing));

  const malformed = await refresh("not-a-real-token");
  const malformedBody = await malformed.json();
  assert.equal(malformed.status, 401);
  assert.equal(malformedBody.code, "INVALID_REFRESH_TOKEN");

  const session = await login("six@example.test");
  const six = [...users.values()].find((user) => user.email === "six@example.test");
  const record = refreshTokens.find((item) => item.userId === six.id);
  record.expiresAt = new Date(Date.now() - 1000);

  const expired = await refresh(session.cookie.value);
  const expiredBody = await expired.json();
  assert.equal(expired.status, 401);
  assert.equal(expiredBody.code, "INVALID_REFRESH_TOKEN");
  assert.ok(record.revokedAt, "expired tokens revoke their family");
});

test("cookie-authenticated endpoints reject untrusted or missing origins", async () => {
  const session = await login("seven@example.test");

  const untrusted = await refresh(session.cookie.value, "http://evil.example");
  const untrustedBody = await untrusted.json();
  assert.equal(untrusted.status, 403);
  assert.equal(untrustedBody.code, "CSRF_ORIGIN_REJECTED");

  const missingOrigin = await refresh(session.cookie.value, null);
  const missingOriginBody = await missingOrigin.json();
  assert.equal(missingOrigin.status, 403);
  assert.equal(missingOriginBody.code, "CSRF_ORIGIN_REQUIRED");

  const logout = await request("/api/v1/auth/logout", {
    method: "POST",
    headers: { Origin: "http://evil.example" },
    cookie: session.cookie.value,
  });
  assert.equal(logout.status, 403);

  const refererOnly = await request("/api/v1/auth/refresh", {
    method: "POST",
    headers: { Referer: `${TRUSTED_ORIGIN}/dashboard` },
    cookie: session.cookie.value,
  });
  assert.equal(refererOnly.status, 200);
});

test("login requires a trusted browser origin", async () => {
  await ensureUser("origin-login@example.test");

  const missingOrigin = await request("/api/v1/auth/login", {
    method: "POST",
    body: { email: "origin-login@example.test", password: PASSWORD },
  });
  const missingBody = await missingOrigin.json();
  assert.equal(missingOrigin.status, 403);
  assert.equal(missingBody.code, "CSRF_ORIGIN_REQUIRED");

  const untrusted = await request("/api/v1/auth/login", {
    method: "POST",
    headers: { Origin: "http://evil.example" },
    body: { email: "origin-login@example.test", password: PASSWORD },
  });
  const untrustedBody = await untrusted.json();
  assert.equal(untrusted.status, 403);
  assert.equal(untrustedBody.code, "CSRF_ORIGIN_REJECTED");

  const trusted = await request("/api/v1/auth/login", {
    method: "POST",
    headers: { Origin: TRUSTED_ORIGIN },
    body: { email: "origin-login@example.test", password: PASSWORD },
  });
  assert.equal(trusted.status, 200);
});

test("CORS reflects only configured origins and allows credentials", async () => {
  const preflight = await request("/api/v1/auth/login", {
    method: "OPTIONS",
    headers: {
      Origin: TRUSTED_ORIGIN,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(
    preflight.headers.get("access-control-allow-origin"),
    TRUSTED_ORIGIN
  );
  assert.equal(
    preflight.headers.get("access-control-allow-credentials"),
    "true"
  );
  assert.match(preflight.headers.get("vary") || "", /Origin/i);

  const rejectedPreflight = await request("/api/v1/auth/login", {
    method: "OPTIONS",
    headers: {
      Origin: "http://evil.example",
      "Access-Control-Request-Method": "POST",
    },
  });
  assert.equal(rejectedPreflight.headers.get("access-control-allow-origin"), null);

  const allowed = await request("/", { headers: { Origin: TRUSTED_ORIGIN } });
  assert.equal(allowed.headers.get("access-control-allow-origin"), TRUSTED_ORIGIN);

  const rejected = await request("/", { headers: { Origin: "http://evil.example" } });
  assert.equal(rejected.headers.get("access-control-allow-origin"), null);
});

test("API security headers are present and HSTS stays off without HTTPS", async () => {
  const response = await request("/api/v1/health");

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-security-policy") || "",
    /default-src 'none'/
  );
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("strict-transport-security"), null);
  assert.equal(response.headers.get("x-powered-by"), null);
});

test("liveness does not query the database and readiness does", async () => {
  const before = readinessQueries;
  const health = await request("/api/v1/health");
  assert.equal(health.status, 200);
  assert.equal(readinessQueries, before);

  const ready = await request("/api/v1/ready");
  const readyBody = await ready.json();
  assert.equal(ready.status, 200, JSON.stringify(readyBody));
  assert.equal(readinessQueries, before + 1);
  assert.equal(readyBody.data.status, "ready");
});

test("access tokens are validated for expiry, type, signature, and subject", async () => {
  const user = await ensureUser("eight@example.test");
  const sign = (overrides, { secret = process.env.JWT_SECRET, ...options } = {}) =>
    jwt.sign(
      { sub: user.id, email: user.email, role: user.role, typ: "access", ...overrides },
      secret,
      {
        algorithm: "HS256",
        expiresIn: "5m",
        issuer: "auth-service",
        audience: "banking-system",
        ...options,
      }
    );

  const valid = await request("/api/v1/auth/me", {
    headers: { Authorization: `Bearer ${sign({})}` },
  });
  assert.equal(valid.status, 200);

  const expired = await request("/api/v1/auth/me", {
    headers: { Authorization: `Bearer ${sign({}, { expiresIn: -10 })}` },
  });
  const expiredBody = await expired.json();
  assert.equal(expired.status, 401);
  assert.equal(expiredBody.code, "TOKEN_EXPIRED");

  const wrongType = await request("/api/v1/auth/me", {
    headers: { Authorization: `Bearer ${sign({ typ: "refresh" })}` },
  });
  assert.equal(wrongType.status, 401);
  assert.equal((await wrongType.json()).code, "INVALID_TOKEN_TYPE");

  const wrongSecret = await request("/api/v1/auth/me", {
    headers: {
      Authorization: `Bearer ${sign({}, { secret: "a-different-secret-0123456789abcdef" })}`,
    },
  });
  assert.equal(wrongSecret.status, 401);
  assert.equal((await wrongSecret.json()).code, "INVALID_TOKEN");

  const malformed = await request("/api/v1/auth/me", {
    headers: { Authorization: "Bearer not.a.jwt" },
  });
  assert.equal(malformed.status, 401);
  assert.equal((await malformed.json()).code, "INVALID_TOKEN");

  const missing = await request("/api/v1/auth/me");
  assert.equal(missing.status, 401);
  assert.equal((await missing.json()).code, "TOKEN_MISSING");
});

test("failed logins are throttled per IP and email without locking the account", async () => {
  await ensureUser("rate@example.test");
  const attempt = (password) =>
    request("/api/v1/auth/login", {
      method: "POST",
      headers: { Origin: TRUSTED_ORIGIN },
      body: { email: "rate@example.test", password },
    });

  for (let index = 0; index < 3; index += 1) {
    const response = await attempt("WrongPassword1");
    assert.equal(response.status, 401);
  }

  const limited = await attempt("WrongPassword1");
  const limitedBody = await limited.json();
  assert.equal(limited.status, 429);
  assert.equal(limitedBody.success, false);
  assert.ok(Number(limited.headers.get("retry-after")) >= 1);

  // The budget is keyed by email and IP, not by account: a different email
  // from the same IP is unaffected.
  const otherEmail = await request("/api/v1/auth/login", {
    method: "POST",
    headers: { Origin: TRUSTED_ORIGIN },
    body: { email: "nine@example.test", password: "WrongPassword1" },
  });
  assert.equal(otherEmail.status, 401);
});
