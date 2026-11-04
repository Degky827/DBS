const router = require("express").Router();

const ROUTES = require("../../constants/routes");
const authenticate = require("../../middlewares/authenticate");
const requireRole = require("../../middlewares/requireRole");
const validate = require("../../middlewares/validate");
const ApiResponse = require("../../utils/ApiResponse");
const { parseQuery } = require("../../utils/query");
const usersService = require("../users/users.service");
const ledgerVerify = require("./ledgerVerify.service");
const {
  listRunsSchema,
  listIssuesSchema,
  startRunSchema,
  issueActionSchema,
} = require("./ledger.validation");

// Ledger integrity is a finance and administration concern. Nothing here is
// customer-visible: the responses expose internal references and account codes.
const requireIntegrityRole = requireRole("ADMIN", "FINANCIAL_OFFICER");

const getOverview = async (req, res) => {
  const overview = await ledgerVerify.integrityOverview();
  return ApiResponse.success(res, overview, "Ledger integrity summary fetched");
};

const startRun = async (req, res) => {
  const actorUserId = await usersService.getResolvedUserId(req.user);
  const run = await ledgerVerify.runVerification({
    trigger: "MANUAL",
    actorUserId,
    businessDate: req.body.businessDate,
  });
  return ApiResponse.success(res, { run }, "Ledger verification run completed");
};

const listRuns = async (req, res) => {
  const page = await ledgerVerify.listRuns(parseQuery(listRunsSchema, req.query));
  return ApiResponse.success(res, page, "Ledger verification runs fetched");
};

const getRun = async (req, res) => {
  const run = await ledgerVerify.getRun(req.params.reference);
  return ApiResponse.success(res, { run }, "Ledger verification run fetched");
};

const listIssues = async (req, res) => {
  const page = await ledgerVerify.listIssues(parseQuery(listIssuesSchema, req.query));
  return ApiResponse.success(res, page, "Ledger verification issues fetched");
};

const issueAction = (action) => async (req, res) => {
  const actorUserId = await usersService.getResolvedUserId(req.user);
  const issue = await ledgerVerify.transitionIssue(req.params.issueId, action, {
    actorUserId,
    note: req.body.note,
  });
  return ApiResponse.success(res, { issue }, `Ledger verification issue ${action}d`);
};

router.get(ROUTES.LEDGER.INTEGRITY, authenticate, requireIntegrityRole, getOverview);
router.get(ROUTES.LEDGER.VERIFICATION_RUNS, authenticate, requireIntegrityRole, listRuns);
router.post(
  ROUTES.LEDGER.VERIFICATION_RUNS,
  authenticate,
  requireIntegrityRole,
  validate(startRunSchema),
  startRun
);
router.get(ROUTES.LEDGER.VERIFICATION_RUN, authenticate, requireIntegrityRole, getRun);
router.get(ROUTES.LEDGER.VERIFICATION_ISSUES, authenticate, requireIntegrityRole, listIssues);
router.post(
  ROUTES.LEDGER.ISSUE_ACKNOWLEDGE,
  authenticate,
  requireIntegrityRole,
  validate(issueActionSchema),
  issueAction("acknowledge")
);
router.post(
  ROUTES.LEDGER.ISSUE_RESOLVE,
  authenticate,
  requireIntegrityRole,
  validate(issueActionSchema),
  issueAction("resolve")
);
// Suppression and reopening change what the bank is willing to ignore, so they
// stay with ADMIN.
router.post(
  ROUTES.LEDGER.ISSUE_SUPPRESS,
  authenticate,
  requireRole("ADMIN"),
  validate(issueActionSchema),
  issueAction("suppress")
);
router.post(
  ROUTES.LEDGER.ISSUE_REOPEN,
  authenticate,
  requireRole("ADMIN"),
  validate(issueActionSchema),
  issueAction("reopen")
);

module.exports = router;
