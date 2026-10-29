const router = require("express").Router();

const ROUTES = require("../../constants/routes");
const authenticate = require("../../middlewares/authenticate");
const requireKycApproval = require("../../middlewares/requireKycApproval");
const requireRole = require("../../middlewares/requireRole");
const validate = require("../../middlewares/validate");
const ApiError = require("../../utils/ApiError");
const ApiResponse = require("../../utils/ApiResponse");
const usersService = require("../users/users.service");
const {
  ChapaAdapter,
  getPaymentsService,
  setCustomPaymentsService,
} = require("./payments.factory");
const withdrawalsService = require("./withdrawals.service");
const { depositSchema, withdrawalSchema } = require("./payments.validation");

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

const requireConfiguredProvider = (req, res, next) => {
  try {
    getPaymentsService();
    return next();
  } catch (error) {
    return next(error);
  }
};

const createDeposit = async (req, res) => {
  const service = getPaymentsService();
  const userId = await usersService.getResolvedUserId(req.user);
  const profile = await usersService.getMyProfile(req.user);

  const result = await service.initiateDeposit({
    userId,
    userProfile: profile.user,
    amount: req.body.amount,
    idempotencyKey: req.idempotencyKey,
  });

  return ApiResponse.success(
    res,
    { payment: result.payment },
    result.replayed ? "Deposit request replayed" : "Deposit initiated",
    result.replayed ? 200 : 201
  );
};

const verifyDeposit = async (req, res) => {
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
};

const handleWebhook = async (req, res) => {
  const service = getPaymentsService();
  const result = await service.handleWebhook(req);

  return ApiResponse.success(
    res,
    { payment: result.payment },
    "Webhook processed successfully"
  );
};

const createDepositRefundUnsupported = (req, res, next) => {
  return next(
    ApiError.notImplemented(
      "Chapa refunds are not supported by this service; internal transfer reversals are available to administrators",
      "PROVIDER_REFUND_UNSUPPORTED"
    )
  );
};

const createWithdrawal = async (req, res) => {
  const userId = await usersService.getResolvedUserId(req.user);
  const result = await withdrawalsService.initiateWithdrawal({
    userId,
    amount: req.body.amount,
    idempotencyKey: req.idempotencyKey,
  });

  return ApiResponse.success(
    res,
    { withdrawal: result.withdrawal },
    result.replayed
      ? "Withdrawal request replayed"
      : "Withdrawal reserved for payout",
    result.replayed ? 200 : 201
  );
};

const getWithdrawal = async (req, res) => {
  const userId = await usersService.getResolvedUserId(req.user);
  const result = await withdrawalsService.getWithdrawal(
    userId,
    req.params.reference
  );
  return ApiResponse.success(res, result, "Withdrawal fetched");
};

const cancelWithdrawal = async (req, res) => {
  const userId = await usersService.getResolvedUserId(req.user);
  const result = await withdrawalsService.cancelWithdrawal({
    userId,
    reference: req.params.reference,
    reason: req.body?.reason ?? null,
  });
  return ApiResponse.success(
    res,
    { withdrawal: result.withdrawal },
    result.replayed ? "Withdrawal already cancelled" : "Withdrawal cancelled",
    result.replayed ? 200 : 200
  );
};

// Authenticated deposit initiation
router.post(
  ROUTES.PAYMENTS.DEPOSITS,
  authenticate,
  requireKycApproval,
  requireConfiguredProvider,
  validate(depositSchema),
  requireIdempotencyKey,
  createDeposit
);

// Authenticated return check/verification
router.get(
  ROUTES.PAYMENTS.DEPOSITS_VERIFY,
  authenticate,
  requireKycApproval,
  verifyDeposit
);

// Chapa Test Mode does not expose a refund API. Internal transfers are
// reversed through the ledger instead; this route fails closed.
router.post(
  ROUTES.PAYMENTS.DEPOSIT_REFUNDS,
  authenticate,
  requireRole("ADMIN"),
  createDepositRefundUnsupported
);

// Webhook endpoint (unauthenticated, signature-protected)
router.post(ROUTES.PAYMENTS.WEBHOOK, handleWebhook);

// Internal withdrawal lifecycle: funds are reserved on request and released
// only by an explicit cancellation. No external payout is performed because
// the configured provider has no payout capability.
router.post(
  ROUTES.PAYMENTS.WITHDRAWALS,
  authenticate,
  requireKycApproval,
  validate(withdrawalSchema),
  requireIdempotencyKey,
  createWithdrawal
);
router.get(
  ROUTES.PAYMENTS.WITHDRAWAL_BY_REFERENCE,
  authenticate,
  getWithdrawal
);
router.post(
  ROUTES.PAYMENTS.WITHDRAWAL_CANCEL,
  authenticate,
  cancelWithdrawal
);

module.exports = router;
module.exports.setCustomPaymentsService = setCustomPaymentsService;
module.exports.getPaymentsService = getPaymentsService;
module.exports.ChapaAdapter = ChapaAdapter;
