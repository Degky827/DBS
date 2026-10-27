const ApiError = require("../../utils/ApiError");

const createPaymentProviderBoundary = (adapter) => {
  if (!adapter || (typeof adapter.isConfigured === "boolean" && !adapter.isConfigured)) {
    throw ApiError.notImplemented(
      "External payments are unavailable until a payment provider is configured",
      "PAYMENT_PROVIDER_NOT_CONFIGURED"
    );
  }

  for (const method of ["initiate", "getStatus", "verifyWebhook"]) {
    if (typeof adapter[method] !== "function") {
      throw new TypeError(`Payment provider adapter must implement ${method}`);
    }
  }

  return Object.freeze({
    initiate: adapter.initiate.bind(adapter),
    getStatus: adapter.getStatus.bind(adapter),
    verifyWebhook: adapter.verifyWebhook.bind(adapter),
  });
};

module.exports = { createPaymentProviderBoundary };
