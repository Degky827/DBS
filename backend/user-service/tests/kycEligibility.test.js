process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  "postgresql://test:test@localhost:5432/user_service_unit_test?schema=public";
process.env.AUTH_MODE = "dev";
process.env.LOG_LEVEL = "silent";
process.env.KYC_SERVICE_URL = "https://kyc.test/api/v1/kyc";
process.env.INTERNAL_SERVICE_KEY = "unit-test-internal-key";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");

const kycClient = require("../src/services/kycClient");
const kycEligibility = require("../src/services/kycEligibility");
const requireKycApproval = require("../src/middlewares/requireKycApproval");
const PaymentsService = require("../src/modules/payments/payments.service");

const USER_ID = "6f1c2a4e-2b7d-4c1a-9f3e-8a5b6c7d8e9f";

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const withFetch = async (impl, run) => {
  const original = global.fetch;
  global.fetch = impl;
  try {
    return await run();
  } finally {
    global.fetch = original;
  }
};

const assertApiError = (statusCode, code) => (error) => {
  assert.equal(error.name, "ApiError");
  assert.equal(error.statusCode, statusCode);
  assert.equal(error.code, code);
  return true;
};

const approvedClient = (calls = []) => ({
  async getUserKycStatus(userId) {
    calls.push(userId);
    return { status: "APPROVED", isApproved: true };
  },
});

const buildProtectedApp = () => {
  const state = { handlerCalls: 0, kyc: undefined };
  const app = express();
  app.post(
    "/protected",
    (req, res, next) => {
      req.user = { id: USER_ID, authMode: "jwt" };
      next();
    },
    requireKycApproval,
    (req, res) => {
      state.handlerCalls += 1;
      state.kyc = req.kyc;
      res.status(201).json({ ok: true });
    }
  );
  app.use((error, req, res, _next) => {
    return res
      .status(error.statusCode || 500)
      .json({ code: error.code || "ERROR", message: error.message });
  });
  return { app, state };
};

test("kyc client requests the internal status with the service key and parses approval", async () => {
  let captured;
  await withFetch(
    async (url, options) => {
      captured = { url, options };
      return jsonResponse({
        success: true,
        message: "KYC status fetched",
        data: { userId: USER_ID, status: "APPROVED", isApproved: true },
      });
    },
    async () => {
      const result = await kycClient.getUserKycStatus(USER_ID);
      assert.deepEqual(result, {
        status: "APPROVED",
        isApproved: true,
        tier: null,
      });
    }
  );

  assert.equal(captured.url, `https://kyc.test/api/v1/kyc/internal/users/${USER_ID}/status`);
  assert.equal(captured.options.headers["X-Internal-Service-Key"], "unit-test-internal-key");
  assert.equal(captured.options.method, "GET");
});

test("the tier payload is parsed into limits the money paths clamp with", async () => {
  await withFetch(
    async () =>
      jsonResponse({
        data: {
          userId: USER_ID,
          status: "APPROVED",
          isApproved: true,
          tierCode: "TIER_2",
          tierId: "tier-def-sample-tier-2",
          tierVersion: 3,
          tierSource: "ASSIGNMENT",
          allowedOperations: ["DEPOSIT", "TRANSFER", "WITHDRAWAL"],
          limits: [
            {
              operation: "TRANSFER",
              currency: "ETB",
              minAmount: "0.00",
              maxAmount: "25000.00",
              dailyAmount: "50000.00",
              dailyCount: 20,
              monthlyAmount: "200000.00",
              maxBalance: null,
              isAllowed: true,
            },
            {
              operation: "WITHDRAWAL",
              currency: "ETB",
              minAmount: 0,
              maxAmount: null,
              dailyAmount: null,
              dailyCount: null,
              monthlyAmount: null,
              maxBalance: null,
              isAllowed: false,
            },
          ],
        },
      }),
    async () => {
      const result = await kycClient.getUserKycStatus(USER_ID);
      assert.equal(result.tier.code, "TIER_2");
      assert.equal(result.tier.version, 3);
      assert.equal(result.tier.source, "ASSIGNMENT");
      assert.deepEqual(result.tier.allowedOperations, ["DEPOSIT", "TRANSFER", "WITHDRAWAL"]);
      // Decimals stay strings so no consumer trusts a float round-trip.
      assert.equal(result.tier.limits[0].maxAmount, "25000.00");
      assert.equal(result.tier.limits[0].maxBalance, null);
      assert.equal(result.tier.limits[1].minAmount, "0");
      assert.equal(result.tier.limits[1].isAllowed, false);
    }
  );

  // A pre-tier response, and the documented "no tier policy" source, both mean
  // platform policy alone rather than an unlimited tier.
  for (const data of [
    { status: "APPROVED", isApproved: true },
    {
      status: "APPROVED",
      isApproved: true,
      tierCode: null,
      tierSource: "NOT_CONFIGURED",
      limits: [],
    },
  ]) {
    await withFetch(
      async () => jsonResponse({ data }),
      async () => {
        const result = await kycClient.getUserKycStatus(USER_ID);
        assert.equal(result.tier, null);
      }
    );
  }
});

test("a malformed tier payload is unavailable, not an unclamped approval", async () => {
  const cases = [
    { status: "APPROVED", isApproved: true, tierCode: "TIER_1", limits: {} },
    {
      status: "APPROVED",
      isApproved: true,
      tierCode: "TIER_1",
      limits: [{ operation: "TRANSFER", currency: "ETB", maxAmount: "many" }],
    },
    {
      status: "APPROVED",
      isApproved: true,
      tierCode: "TIER_1",
      limits: [{ operation: "TRANSFER", currency: "etb" }],
    },
    {
      status: "APPROVED",
      isApproved: true,
      tierCode: "TIER_1",
      limits: [{ operation: "TRANSFER", currency: "ETB", dailyCount: -2 }],
    },
    {
      status: "APPROVED",
      isApproved: true,
      limits: [{ operation: "TRANSFER", currency: "ETB" }],
    },
  ];

  for (const data of cases) {
    await withFetch(
      async () => jsonResponse({ data }),
      async () => {
        await assert.rejects(kycClient.getUserKycStatus(USER_ID), (error) => {
          assert.equal(error.name, "KycUnavailableError");
          return true;
        });
      }
    );
  }
});

test("kyc client fails closed on error statuses, invalid json and malformed payloads", async () => {
  const cases = [
    async () => jsonResponse({ success: false }, 500),
    async () => jsonResponse({ success: false }, 401),
    async () => new Response("not-json", { status: 200 }),
    async () => jsonResponse({ data: null }),
    async () => jsonResponse({ data: { status: "APPROVED" } }),
    async () => jsonResponse({ data: { isApproved: "true" } }),
    async () => {
      throw new Error("connect ECONNREFUSED");
    },
  ];

  for (const impl of cases) {
    await withFetch(impl, async () => {
      await assert.rejects(kycClient.getUserKycStatus(USER_ID), (error) => {
        assert.equal(error.name, "KycUnavailableError");
        return true;
      });
    });
  }
});

test("eligibility allows only an explicit approval for the verified subject", async () => {
  const calls = [];
  kycEligibility.setKycClient(approvedClient(calls));
  try {
    const result = await kycEligibility.assertApproved(USER_ID);
    assert.equal(result.isApproved, true);
    assert.deepEqual(calls, [USER_ID]);
  } finally {
    kycEligibility.setKycClient(null);
  }
});

test("eligibility rejects every non-approved authoritative status with 403", async () => {
  const statuses = [
    "NOT_SUBMITTED",
    "DRAFT",
    "IN_PROGRESS",
    "PENDING_REVIEW",
    "NEEDS_RESUBMISSION",
    "REJECTED",
  ];

  for (const status of statuses) {
    kycEligibility.setKycClient({
      async getUserKycStatus() {
        return { status, isApproved: false };
      },
    });
    try {
      await assert.rejects(
        kycEligibility.assertApproved(USER_ID),
        assertApiError(403, "KYC_NOT_APPROVED")
      );
    } finally {
      kycEligibility.setKycClient(null);
    }
  }
});

test("eligibility fails closed with 503 when the status cannot be obtained", async () => {
  kycEligibility.setKycClient({
    async getUserKycStatus() {
      throw new kycClient.KycUnavailableError("boom");
    },
  });
  try {
    await assert.rejects(kycEligibility.assertApproved(USER_ID), (error) => {
      assertApiError(503, "KYC_STATUS_UNAVAILABLE")(error);
      assert.equal(error.message.includes("kyc.test"), false);
      assert.equal(error.message.includes("unit-test-internal-key"), false);
      return true;
    });
  } finally {
    kycEligibility.setKycClient(null);
  }
});

test("the KYC gate uses the verified JWT subject and lets approved requests through", async () => {
  const calls = [];
  kycEligibility.setKycClient(approvedClient(calls));
  const { app, state } = buildProtectedApp();

  try {
    const response = await request(app).post("/protected").send({});
    assert.equal(response.status, 201);
    assert.deepEqual(calls, [USER_ID]);
    assert.equal(state.handlerCalls, 1);
  } finally {
    kycEligibility.setKycClient(null);
  }
});

test("the gate hands the resolved tier to the financial handler", async () => {
  const tier = {
    code: "TIER_1",
    version: 1,
    source: "FALLBACK",
    allowedOperations: ["DEPOSIT", "TRANSFER"],
    limits: [],
  };
  kycEligibility.setKycClient({
    async getUserKycStatus() {
      return { status: "APPROVED", isApproved: true, tier };
    },
  });
  const { app, state } = buildProtectedApp();

  try {
    const response = await request(app).post("/protected").send({});
    assert.equal(response.status, 201);
    assert.equal(state.kyc.isApproved, true);
    assert.equal(state.kyc.tier, tier);
  } finally {
    kycEligibility.setKycClient(null);
  }
});

test("non-approved users are rejected before the financial handler runs", async () => {
  const { app, state } = buildProtectedApp();

  for (const status of ["NOT_SUBMITTED", "PENDING_REVIEW", "REJECTED"]) {
    kycEligibility.setKycClient({
      async getUserKycStatus() {
        return { status, isApproved: false };
      },
    });
    try {
      const response = await request(app).post("/protected").send({});
      assert.equal(response.status, 403);
      assert.equal(response.body.code, "KYC_NOT_APPROVED");
    } finally {
      kycEligibility.setKycClient(null);
    }
  }

  assert.equal(state.handlerCalls, 0);
});

test("financial handlers are blocked with 503 when KYC status is unavailable", async () => {
  kycEligibility.setKycClient({
    async getUserKycStatus() {
      throw new kycClient.KycUnavailableError("timeout");
    },
  });
  const { app, state } = buildProtectedApp();

  try {
    const response = await request(app).post("/protected").send({});
    assert.equal(response.status, 503);
    assert.equal(response.body.code, "KYC_STATUS_UNAVAILABLE");
    assert.equal(state.handlerCalls, 0);
  } finally {
    kycEligibility.setKycClient(null);
  }
});

test("provider webhooks settle without a KYC check because funds already left the customer", async () => {
  let kycCalls = 0;
  kycEligibility.setKycClient({
    async getUserKycStatus() {
      kycCalls += 1;
      throw new Error("should not be called");
    },
  });

  const completed = {
    id: "payment-1",
    reference: "dep_test",
    provider: "CHAPA",
    providerRef: "CHAPA-dep_test",
    type: "DEPOSIT",
    status: "COMPLETED",
    amount: { toFixed: () => "20.00" },
    currency: "ETB",
    checkoutUrl: "https://checkout.chapa.global/session/dep_test",
    failureReason: null,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T00:01:00.000Z"),
  };
  const db = {
    payment: {
      async findFirst() {
        return {
          id: "payment-1",
          reference: "dep_test",
          userId: USER_ID,
          status: "COMPLETED",
        };
      },
      async findUnique() {
        return completed;
      },
    },
    async $transaction(fn) {
      return fn({
        paymentWebhookEvent: {
          async createMany() {
            return { count: 1 };
          },
        },
        payment: {
          async findUnique() {
            return completed;
          },
        },
      });
    },
  };

  try {
    const service = new PaymentsService({ verifyWebhook: () => true }, db);
    const result = await service.processVerification("dep_test", {
      webhookDelivery: {
        bodyHash: "a".repeat(64),
        event: "payment.success",
        mode: "test",
      },
    });
    assert.equal(result.alreadyProcessed, true);
    assert.equal(kycCalls, 0);
  } finally {
    kycEligibility.setKycClient(null);
  }
});
