const env = require("../../config/env");
const ChapaAdapter = require("./chapa.adapter");
const { createPaymentProviderBoundary } = require("./paymentProvider");
const PaymentsService = require("./payments.service");

const chapaAdapter = new ChapaAdapter({
  secretKey: env.CHAPA_SECRET_KEY,
  webhookSecret: env.CHAPA_WEBHOOK_SECRET,
  baseUrl: env.CHAPA_BASE_URL,
  callbackUrl: env.CHAPA_CALLBACK_URL,
  returnUrl: env.CHAPA_RETURN_URL,
});

let paymentsService;

const getPaymentsService = () => {
  if (!paymentsService) {
    const boundary = createPaymentProviderBoundary(chapaAdapter);
    paymentsService = new PaymentsService(boundary);
  }
  return paymentsService;
};

// Exported for tests and the reconciliation scheduler to use one instance.
const setCustomPaymentsService = (customService) => {
  paymentsService = customService;
};

module.exports = {
  chapaAdapter,
  ChapaAdapter,
  getPaymentsService,
  setCustomPaymentsService,
};
