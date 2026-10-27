const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const ChapaAdapter = require("../src/modules/payments/chapa.adapter");

const adapterConfig = {
  secretKey: "CHAPA_TEST_mock-private-key",
  webhookSecret: "mock-webhook-secret-long-enough",
  callbackUrl: "https://bank.example/api/v1/payments/webhook",
  returnUrl: "https://bank.example/payments",
};

const response = (data, ok = true) => ({
  ok,
  async json() {
    return data;
  },
});

test("Chapa v2 hosted checkout sends integer cents, merchant reference and API idempotency", async () => {
  let requestUrl;
  let requestOptions;
  const adapter = new ChapaAdapter({
    ...adapterConfig,
    fetchImpl: async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return response({
        status: "success",
        data: {
          checkout_url: "https://checkout.chapa.global/session/chapa-ref",
          merchant_reference: "d_testref",
        },
      });
    },
  });

  const result = await adapter.initiate({
    amount: "12.34",
    currency: "ETB",
    email: "customer@example.test",
    firstName: "Test",
    lastName: "Customer",
    phoneNumber: "+251911223344",
    txRef: "d_testref",
  });

  assert.equal(requestUrl, "https://api.chapa.global/v2/payments/hosted");
  assert.equal(requestOptions.method, "POST");
  assert.equal(requestOptions.headers.Authorization, "Bearer CHAPA_TEST_mock-private-key");
  assert.equal(requestOptions.headers["Idempotency-Key"], "d_testref");
  const sent = JSON.parse(requestOptions.body);
  assert.equal(sent.amount, 1234);
  assert.equal(sent.currency, "ETB");
  assert.equal(sent.merchant_reference, "d_testref");
  assert.equal(sent.customer.email, "customer@example.test");
  assert.equal(
    new URL(sent.return_url).searchParams.get("merchant_reference"),
    "d_testref"
  );
  assert.equal(result.providerRef, "chapa-ref");
  assert.equal(result.merchantReference, "d_testref");
});

test("Chapa v2 verification converts integer minor units and returns the verified merchant reference", async () => {
  const adapter = new ChapaAdapter({
    ...adapterConfig,
    fetchImpl: async () =>
      response({
        status: "success",
        data: {
          merchant_reference: "d_testref",
          chapa_reference: "CH-123",
          processor_reference: "processor-123",
          status: "SUCCESS",
          amount: 1234,
          currency: "ETB",
        },
      }),
  });
  const verified = await adapter.getStatus("d_testref");
  assert.deepEqual(verified, {
    status: "SUCCESS",
    rawStatus: "SUCCESS",
    merchantReference: "d_testref",
    providerRef: "CH-123",
    amount: "12.34",
    currency: "ETB",
  });
});

test("webhook verification uses exact raw bytes and rejects parsed-body fallbacks", () => {
  const adapter = new ChapaAdapter(adapterConfig);
  const rawBody = Buffer.from('{"event":"payment.success", "amount":"1234"}');
  const signature = crypto
    .createHmac("sha256", adapterConfig.webhookSecret)
    .update(rawBody)
    .digest("hex");

  assert.equal(
    adapter.verifyWebhook({
      rawBody,
      body: JSON.parse(rawBody.toString("utf8")),
      headers: { "x-chapa-signature": signature },
    }),
    true
  );
  assert.equal(
    adapter.verifyWebhook({
      body: JSON.parse(rawBody.toString("utf8")),
      headers: { "x-chapa-signature": signature },
    }),
    false
  );
});

test("provider verification errors and malformed checkout URLs are not treated as payment failure", async () => {
  const verificationAdapter = new ChapaAdapter({
    ...adapterConfig,
    fetchImpl: async () => response({ status: "error", message: "not verified" }),
  });
  await assert.rejects(verificationAdapter.getStatus("d_testref"), {
    code: "PAYMENT_PROVIDER_ERROR",
    statusCode: 502,
  });

  const checkoutAdapter = new ChapaAdapter({
    ...adapterConfig,
    fetchImpl: async () =>
      response({ status: "success", data: { checkout_url: "http://untrusted.test/" } }),
  });
  await assert.rejects(
    checkoutAdapter.initiate({
      amount: "1.00",
      currency: "ETB",
      email: "customer@example.test",
      txRef: "d_testref",
    }),
    { code: "PAYMENT_PROVIDER_ERROR", statusCode: 502 }
  );
});
