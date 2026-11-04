const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/user_account_test?schema=public";
process.env.AUTH_MODE = "jwt";
process.env.JWT_SECRET = "user-account-test-secret-0123456789abcdef";
process.env.AUTH_SERVICE_URL = "https://auth.test/api/v1";
process.env.INTERNAL_SERVICE_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.STEP_UP_TTL_MS = "60000";
process.env.LOG_LEVEL = "silent";
process.env.OUTBOX_ENABLED = "true";

const { Prisma } = require("@prisma/client");

const profiles = new Map();
const wallets = new Map();
const calls = { auth: [], devSessions: [], walletUpdates: [], outbox: [] };
const pendingWithdrawals = 0;
let pendingDeposits = 0;

const fakePrisma = {
  // Status changes run inside an interactive transaction so the outbox row can
  // be written with the same connection as the status update.
  $transaction: async (operations) =>
    typeof operations === "function" ? operations(fakePrisma) : Promise.all(operations),
  outboxEvent: {
    create: async ({ data }) => {
      calls.outbox.push(data);
      return { id: `outbox-${calls.outbox.length}`, eventId: data.eventId };
    },
  },
  userProfile: {
    findUnique: async ({ where }) => profiles.get(where.id) || null,
    update: async ({ where, data }) => {
      const profile = profiles.get(where.id);
      Object.assign(profile, data);
      return profile;
    },
  },
  wallet: {
    findUnique: async ({ where }) => wallets.get(where.userId) || null,
    updateMany: async ({ where, data }) => {
      calls.walletUpdates.push({ where, data });
      const wallet = wallets.get(where.userId);
      if (wallet) Object.assign(wallet, data);
      return { count: wallet ? 1 : 0 };
    },
  },
  withdrawal: { count: async () => pendingWithdrawals },
  payment: { count: async () => pendingDeposits },
  devSession: {
    updateMany: async ({ where, data }) => {
      calls.devSessions.push({ where, data });
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

const originalFetch = global.fetch;
global.fetch = async (url, options) => {
  const body = JSON.parse(options.body);
  calls.auth.push({ url, body });
  if (url.endsWith("/internal/users/statuses")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          users: body.emails.map((email) => ({
            email,
            status: "FROZEN",
            mfaEnabled: true,
          })),
        },
      }),
    };
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: { status: body.status } }),
  };
};

const accountLifecycle = require("../src/services/accountLifecycle.service");
const requireStepUp = require("../src/middlewares/requireStepUp");
const requireActiveAccount = require("../src/middlewares/requireActiveAccount");

test.after(() => {
  global.fetch = originalFetch;
});

const addProfile = (id, overrides = {}) => {
  const profile = {
    id,
    email: `${id}@example.test`,
    accountStatus: "ACTIVE",
    ...overrides,
  };
  profiles.set(id, profile);
  return profile;
};

const addWallet = (userId, balance) => {
  wallets.set(userId, {
    id: `wallet-${userId}`,
    userId,
    balance: new Prisma.Decimal(balance),
    isActive: true,
  });
};

test("freezing an account requires a reason and revokes sessions everywhere", async () => {
  addProfile("freeze-user");
  addWallet("freeze-user", "25.00");

  await assert.rejects(
    accountLifecycle.changeStatus({
      userId: "freeze-user",
      status: "FROZEN",
      reason: "",
      actorId: "admin-1",
    }),
    (error) => error.code === "VALIDATION_ERROR"
  );

  const result = await accountLifecycle.changeStatus({
    userId: "freeze-user",
    status: "FROZEN",
    reason: "Suspicious activity",
    actorId: "admin-1",
  });

  assert.deepEqual(result, { userId: "freeze-user", accountStatus: "FROZEN" });
  assert.equal(profiles.get("freeze-user").accountStatus, "FROZEN");

  const authCall = calls.auth.find((call) => call.url.endsWith("/users/status"));
  assert.equal(authCall.body.email, "freeze-user@example.test");
  assert.equal(authCall.body.status, "FROZEN");
  assert.equal(authCall.body.actorId, "admin-1");

  assert.equal(calls.devSessions.length > 0, true);

  const frozenEvent = calls.outbox.find((event) => event.aggregateId === "freeze-user");
  assert.equal(frozenEvent.type, "account.status_changed");
  assert.equal(frozenEvent.aggregateType, "user");
  assert.equal(frozenEvent.payload.from, "ACTIVE");
  assert.equal(frozenEvent.payload.to, "FROZEN");
  assert.equal(frozenEvent.payload.reason, "Suspicious activity");
});

test("closed accounts cannot be reopened", async () => {
  addProfile("closed-user", { accountStatus: "CLOSED" });

  await assert.rejects(
    accountLifecycle.changeStatus({
      userId: "closed-user",
      status: "ACTIVE",
      actorId: "admin-1",
    }),
    (error) => error.code === "INVALID_STATUS_TRANSITION"
  );
});

test("closing an account requires a zero balance and no pending activity", async () => {
  addProfile("close-funded");
  addWallet("close-funded", "10.00");

  await assert.rejects(
    accountLifecycle.changeStatus({
      userId: "close-funded",
      status: "CLOSED",
      reason: "Customer request",
      actorId: "admin-1",
    }),
    (error) => error.code === "ACCOUNT_BALANCE_NOT_ZERO"
  );

  addProfile("close-pending");
  addWallet("close-pending", "0.00");
  pendingDeposits = 1;

  await assert.rejects(
    accountLifecycle.changeStatus({
      userId: "close-pending",
      status: "CLOSED",
      reason: "Customer request",
      actorId: "admin-1",
    }),
    (error) => error.code === "ACCOUNT_HAS_PENDING_ACTIVITY"
  );
  pendingDeposits = 0;
});

test("closing a settled account deactivates the wallet and mirrors the status", async () => {
  addProfile("close-ok");
  addWallet("close-ok", "0.00");

  const result = await accountLifecycle.changeStatus({
    userId: "close-ok",
    status: "CLOSED",
    reason: "Customer request",
    actorId: "admin-1",
  });

  assert.equal(result.accountStatus, "CLOSED");
  assert.equal(profiles.get("close-ok").accountStatus, "CLOSED");
  assert.equal(wallets.get("close-ok").isActive, false);
  assert.equal(
    calls.walletUpdates.some((update) => update.data.isActive === false),
    true
  );
});

test("authoritative statuses overlay local admin rows", async () => {
  const rows = await accountLifecycle.overlayAuthoritativeStatus([
    { id: "a", email: "a@example.test", accountStatus: "ACTIVE" },
    { id: "b", email: "b@example.test", accountStatus: "ACTIVE" },
  ]);

  assert.equal(rows[0].accountStatus, "FROZEN");
  assert.equal(rows[0].mfaEnabled, true);
});

const runMiddleware = (middleware, req) => {
  let error = null;
  middleware(req, {}, (value) => {
    error = value || null;
  });
  return error;
};

test("frozen accounts are blocked from financial mutations", () => {
  assert.equal(
    runMiddleware(requireActiveAccount, {
      user: { accountStatus: "ACTIVE" },
    }),
    null
  );

  const error = runMiddleware(requireActiveAccount, {
    user: { accountStatus: "FROZEN" },
  });
  assert.equal(error.statusCode, 403);
  assert.equal(error.code, "ACCOUNT_FROZEN");
});

test("step-up applies only to MFA-enabled accounts and enforces freshness", () => {
  const now = Date.now();

  assert.equal(
    runMiddleware(requireStepUp, {
      user: { authMode: "jwt", mfaEnabled: false },
    }),
    null
  );

  assert.equal(
    runMiddleware(requireStepUp, {
      user: {
        authMode: "jwt",
        mfaEnabled: true,
        amr: ["pwd", "mfa"],
        stepUpAt: now,
      },
    }),
    null
  );

  const stale = runMiddleware(requireStepUp, {
    user: {
      authMode: "jwt",
      mfaEnabled: true,
      amr: ["pwd", "mfa"],
      stepUpAt: now - 10 * 60 * 1000,
    },
  });
  assert.equal(stale.statusCode, 403);
  assert.equal(stale.code, "STEP_UP_REQUIRED");

  const missing = runMiddleware(requireStepUp, {
    user: { authMode: "jwt", mfaEnabled: true, amr: ["pwd"], stepUpAt: now },
  });
  assert.equal(missing.code, "MFA_REQUIRED");
});
