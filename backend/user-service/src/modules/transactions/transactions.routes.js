const router = require("express").Router();

const ApiError = require("../../utils/ApiError");
const ApiResponse = require("../../utils/ApiResponse");
const ROUTES = require("../../constants/routes");
const authenticate = require("../../middlewares/authenticate");
const validate = require("../../middlewares/validate");
const usersService = require("../users/users.service");
const walletsService = require("../wallets/wallets.service");
const {
  transferSchema,
  transactionHistorySchema,
} = require("../wallets/wallets.validation");

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

const createTransfer = async (req, res) => {
  const userId = await usersService.getResolvedUserId(req.user);
  const result = await walletsService.transfer({
    userId,
    destinationWalletId: req.body.destinationWalletId,
    amount: req.body.amount,
    idempotencyKey: req.idempotencyKey,
  });
  return ApiResponse.success(
    res,
    { transaction: result.transaction },
    result.replayed ? "Transfer already processed" : "Transfer completed",
    result.replayed ? 200 : 201
  );
};

const listTransactions = async (req, res) => {
  const userId = await usersService.getResolvedUserId(req.user);
  const result = await walletsService.listTransactions(
    userId,
    req.transactionHistoryQuery
  );
  return ApiResponse.success(res, result, "Transactions fetched");
};

const validateTransactionHistoryQuery = (req, res, next) => {
  const result = transactionHistorySchema.safeParse(req.query);
  if (!result.success) {
    const errors = {};
    for (const issue of result.error.issues) {
      const key = issue.path.length ? issue.path.join(".") : "_query";
      if (!errors[key]) errors[key] = issue.message;
    }
    return next(ApiError.validation(errors));
  }
  req.transactionHistoryQuery = result.data;
  return next();
};

const getTransaction = async (req, res) => {
  const userId = await usersService.getResolvedUserId(req.user);
  const result = await walletsService.getTransaction(userId, req.params.reference);
  return ApiResponse.success(res, result, "Transaction fetched");
};

router.post(
  ROUTES.TRANSACTIONS.TRANSFERS,
  authenticate,
  validate(transferSchema),
  requireIdempotencyKey,
  createTransfer
);
router.get(
  ROUTES.TRANSACTIONS.ROOT,
  authenticate,
  validateTransactionHistoryQuery,
  listTransactions
);
router.get(ROUTES.TRANSACTIONS.BY_REFERENCE, authenticate, getTransaction);

module.exports = router;