const router = require("express").Router();

const ROUTES = require("../../constants/routes");
const authenticate = require("../../middlewares/authenticate");
const requireRole = require("../../middlewares/requireRole");
const validate = require("../../middlewares/validate");
const ApiResponse = require("../../utils/ApiResponse");
const usersService = require("../users/users.service");
const policiesService = require("./policies.service");
const { policyUpdateSchema } = require("./policies.validation");

const formatPolicy = (policy) => ({
  ...policy,
  minAmount: policy.minAmount.toFixed(2),
  maxAmount: policy.maxAmount.toFixed(2),
  dailyOutgoingAmount: policy.dailyOutgoingAmount.toFixed(2),
  feeFlat: policy.feeFlat.toFixed(2),
  feeMin: policy.feeMin.toFixed(2),
  feeMax: policy.feeMax === null ? null : policy.feeMax.toFixed(2),
});

const listPolicies = async (req, res) => {
  const policies = await policiesService.listPolicies();
  return ApiResponse.success(
    res,
    { policies: policies.map(formatPolicy) },
    "Financial policies fetched"
  );
};

const updatePolicy = async (req, res) => {
  const actorUserId = await usersService.getResolvedUserId(req.user);
  const { currency = "ETB", reason, ...input } = req.body;
  const policy = await policiesService.updatePolicy({
    type: req.params.type,
    currency,
    input,
    actorUserId,
    reason,
  });
  return ApiResponse.success(
    res,
    { policy: formatPolicy(policy) },
    "Financial policy updated"
  );
};

// Policy configuration is privileged and audited. Roles come from the
// verified session/JWT only.
router.get(
  ROUTES.ADMIN.FINANCIAL_POLICIES,
  authenticate,
  requireRole("ADMIN"),
  listPolicies
);
router.patch(
  ROUTES.ADMIN.FINANCIAL_POLICY,
  authenticate,
  requireRole("ADMIN"),
  validate(policyUpdateSchema),
  updatePolicy
);

module.exports = router;
