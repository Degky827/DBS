const router = require("express").Router();

const ROUTES = require("../../constants/routes");
const authenticate = require("../../middlewares/authenticate");
const requireRole = require("../../middlewares/requireRole");
const validate = require("../../middlewares/validate");
const ApiResponse = require("../../utils/ApiResponse");
const usersService = require("../users/users.service");
const {
  reconcilePendingPayments,
} = require("./reconciliation.service");
const { reconciliationSchema } = require("../policies/policies.validation");

const runReconciliation = async (req, res) => {
  const actorUserId = await usersService.getResolvedUserId(req.user);
  const summary = await reconcilePendingPayments({
    olderThanMinutes: req.body.olderThanMinutes,
    limit: req.body.limit,
    trigger: "MANUAL",
    actorUserId,
  });
  return ApiResponse.success(res, summary, "Reconciliation run completed");
};

router.post(
  ROUTES.ADMIN.PAYMENT_RECONCILIATION,
  authenticate,
  requireRole("ADMIN"),
  validate(reconciliationSchema),
  runReconciliation
);

module.exports = router;
