const router = require("express").Router();

const ROUTES = require("../../constants/routes");
const env = require("../../config/env");
const authenticate = require("../../middlewares/authenticate");
const validate = require("../../middlewares/validate");
const ApiError = require("../../utils/ApiError");
const ApiResponse = require("../../utils/ApiResponse");
const usersService = require("../users/users.service");
const ChapaAdapter = require("./chapa.adapter");
const { createPaymentProviderBoundary } = require("./paymentProvider");
const PaymentsService = require("./payments.service");
const { depositSchema } = require("./payments.validation");

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

// Exported for testing to inject mock providers
const setCustomPaymentsService = (customService) => {
  paymentsService = customService;
};

const requireIdempotencyKey = (req, res, next) => {
  const key = req.get("Idempotency-Key");
  if (!key || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    return next(
      ApiError.validation({
        idempotencyKey:
          "Idempotency-Key is required and must be 8-128 permitted characters",
      })
    );
  }
  req.idempotencyKey = key;
  return next();
};

const createDeposit = async (req, res, next) => {
  try {
    const service = getPaymentsService();
    const userId = await usersService.getResolvedUserId(req.user);
    const profile = await usersService.getMyProfile(req.user);

    const result = await service.initiateDeposit({
      userId,
      userProfile: profile.user,
      amount: req.body.amount,
      idempotencyKey: req.idempotencyKey,
      returnUrl: req.body.returnUrl,
    });

    return ApiResponse.success(
      res,
      { payment: result.payment },
      result.replayed ? "Deposit request replayed" : "Deposit initiated",
      result.replayed ? 200 : 201
    );
  } catch (error) {
    return next(error);
  }
};

const requireConfiguredProvider = (req, res, next) => {
  try {
    getPaymentsService();
    return next();
  } catch (error) {
    return next(error);
  }
};

const verifyDeposit = async (req, res, next) => {
  try {
    const service = getPaymentsService();
    const userId = await usersService.getResolvedUserId(req.user);

    const result = await service.verifyAndCredit(req.params.reference, userId);

    return ApiResponse.success(
      res,
      { payment: result.payment },
      result.payment.status === "COMPLETED"
        ? "Payment verified and credited"
        : `Payment status: ${result.payment.status}`
    );
  } catch (error) {
    return next(error);
  }
};

const handleWebhook = async (req, res, next) => {
  try {
    const service = getPaymentsService();
    const result = await service.handleWebhook(req);

    return ApiResponse.success(
      res,
      { payment: result.payment },
      "Webhook processed successfully"
    );
  } catch (error) {
    return next(error);
  }
};

const createWithdrawalDisabled = (req, res, next) => {
  return next(
    ApiError.notImplemented(
      "Chapa payouts are not supported by this service",
      "WITHDRAWALS_NOT_SUPPORTED"
    )
  );
};

// Authenticated deposit initiation
router.post(
  ROUTES.PAYMENTS.DEPOSITS,
  authenticate,
  requireConfiguredProvider,
  validate(depositSchema),
  requireIdempotencyKey,
  createDeposit
);

// Authenticated return check/verification
router.get(
  ROUTES.PAYMENTS.DEPOSITS_VERIFY,
  authenticate,
  verifyDeposit
);

// Webhook endpoint (unauthenticated, signature-protected)
router.post(
  ROUTES.PAYMENTS.WEBHOOK,
  handleWebhook
);

// Withdrawal endpoint remains explicitly disabled
router.post(
  ROUTES.PAYMENTS.WITHDRAWALS,
  authenticate,
  createWithdrawalDisabled
);

module.exports = router;
module.exports.setCustomPaymentsService = setCustomPaymentsService;
module.exports.ChapaAdapter = ChapaAdapter;
