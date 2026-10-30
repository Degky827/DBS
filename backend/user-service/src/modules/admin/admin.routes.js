const router = require("express").Router();

const ApiError = require("../../utils/ApiError");
const ApiResponse = require("../../utils/ApiResponse");
const ROUTES = require("../../constants/routes");
const authenticate = require("../../middlewares/authenticate");
const requireRole = require("../../middlewares/requireRole");
const adminService = require("./admin.service");
const {
  periodSchema,
  userListSchema,
  userIdParamsSchema,
  referenceParamsSchema,
  platformTransactionSchema,
  platformPaymentSchema,
  auditLogSchema,
} = require("./admin.validation");

const toFieldErrors = (issues) => {
  const errors = {};
  for (const issue of issues) {
    const key = issue.path.length ? issue.path.join(".") : "_query";
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
};

const validateQuery = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.query || {});
  if (!result.success) {
    return next(ApiError.validation(toFieldErrors(result.error.issues)));
  }
  req.staffQuery = result.data;
  return next();
};

const validateParams = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.params || {});
  if (!result.success) {
    return next(ApiError.validation(toFieldErrors(result.error.issues)));
  }
  req.params = result.data;
  return next();
};

const getOverview = async (req, res) => {
  const data = await adminService.getOverview(req.staffQuery);
  return ApiResponse.success(res, data, "Platform overview fetched");
};

const getAdminAnalytics = async (req, res) => {
  const data = await adminService.getAdminAnalytics(req.staffQuery);
  return ApiResponse.success(res, data, "Platform analytics fetched");
};

const getFinancialAnalytics = async (req, res) => {
  const data = await adminService.getFinancialAnalytics(req.staffQuery);
  return ApiResponse.success(res, data, "Financial analytics fetched");
};

const listUsers = async (req, res) => {
  const data = await adminService.listUsers(req.staffQuery);
  return ApiResponse.success(res, data, "Users fetched");
};

const getUser = async (req, res) => {
  const data = await adminService.getUserById(req.params.userId);
  return ApiResponse.success(res, data, "User fetched");
};

const listTransactions = async (req, res) => {
  const data = await adminService.listPlatformTransactions(req.staffQuery);
  return ApiResponse.success(res, data, "Transactions fetched");
};

const getTransaction = async (req, res) => {
  const data = await adminService.getPlatformTransaction(req.params.reference);
  return ApiResponse.success(res, data, "Transaction fetched");
};

const listPayments = async (req, res) => {
  const data = await adminService.listPlatformPayments(req.staffQuery);
  return ApiResponse.success(res, data, "Payments fetched");
};

const listAuditLogs = async (req, res) => {
  const data = await adminService.listAuditLogs(req.staffQuery);
  return ApiResponse.success(res, data, "Audit records fetched");
};

const requireStaff = requireRole("ADMIN", "FINANCIAL_OFFICER");

router.get(
  ROUTES.ADMIN.OVERVIEW,
  authenticate,
  requireRole("ADMIN"),
  validateQuery(periodSchema),
  getOverview
);
router.get(
  ROUTES.ADMIN.ANALYTICS,
  authenticate,
  requireRole("ADMIN"),
  validateQuery(periodSchema),
  getAdminAnalytics
);
router.get(
  ROUTES.ADMIN.USERS,
  authenticate,
  requireRole("ADMIN"),
  validateQuery(userListSchema),
  listUsers
);
router.get(
  ROUTES.ADMIN.USER_BY_ID,
  authenticate,
  requireRole("ADMIN"),
  validateParams(userIdParamsSchema),
  getUser
);
router.get(
  ROUTES.ADMIN.AUDIT_LOGS,
  authenticate,
  requireRole("ADMIN"),
  validateQuery(auditLogSchema),
  listAuditLogs
);

router.get(
  ROUTES.OPERATIONS.ANALYTICS,
  authenticate,
  requireStaff,
  validateQuery(periodSchema),
  getFinancialAnalytics
);
router.get(
  ROUTES.OPERATIONS.TRANSACTIONS,
  authenticate,
  requireStaff,
  validateQuery(platformTransactionSchema),
  listTransactions
);
router.get(
  ROUTES.OPERATIONS.TRANSACTION_BY_REFERENCE,
  authenticate,
  requireStaff,
  validateParams(referenceParamsSchema),
  getTransaction
);
router.get(
  ROUTES.OPERATIONS.PAYMENTS,
  authenticate,
  requireStaff,
  validateQuery(platformPaymentSchema),
  listPayments
);

module.exports = router;
