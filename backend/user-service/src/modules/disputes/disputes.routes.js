const router = require("express").Router();

const ApiResponse = require("../../utils/ApiResponse");
const { parseQuery } = require("../../utils/query");
const ROUTES = require("../../constants/routes");
const authenticate = require("../../middlewares/authenticate");
const requireActiveAccount = require("../../middlewares/requireActiveAccount");
const requireRole = require("../../middlewares/requireRole");
const validate = require("../../middlewares/validate");
const usersService = require("../users/users.service");
const disputes = require("./disputes.service");
const {
  createDisputeSchema,
  updateDisputeSchema,
  listQuerySchema,
} = require("./disputes.validation");

const openDispute = async (req, res) => {
  const userId = await usersService.getResolvedUserId(req.user);
  const result = await disputes.createDispute({ userId, ...req.body });
  return ApiResponse.success(res, result, "Dispute submitted", 201);
};

const listMine = async (req, res) => {
  const userId = await usersService.getResolvedUserId(req.user);
  const result = await disputes.listUserDisputes(userId, parseQuery(listQuerySchema, req.query));
  return ApiResponse.success(res, result, "Disputes fetched");
};

const getMine = async (req, res) => {
  const userId = await usersService.getResolvedUserId(req.user);
  const result = await disputes.getUserDispute(userId, req.params.reference);
  return ApiResponse.success(res, result, "Dispute fetched");
};

const listAll = async (req, res) => {
  const result = await disputes.listAllDisputes(parseQuery(listQuerySchema, req.query));
  return ApiResponse.success(res, result, "Disputes fetched");
};

const getForStaff = async (req, res) => {
  const result = await disputes.getDisputeForStaff(req.params.reference);
  return ApiResponse.success(res, result, "Dispute fetched");
};

const update = async (req, res) => {
  const actorId = await usersService.getResolvedUserId(req.user);
  const result = await disputes.updateDispute({
    reference: req.params.reference,
    ...req.body,
    actorId,
  });
  return ApiResponse.success(res, result, "Dispute updated");
};

router.post(
  ROUTES.DISPUTES.ROOT,
  authenticate,
  requireActiveAccount,
  validate(createDisputeSchema),
  openDispute
);
router.get(ROUTES.DISPUTES.ROOT, authenticate, listMine);
router.get(ROUTES.DISPUTES.BY_REFERENCE, authenticate, getMine);

router.get(ROUTES.ADMIN.DISPUTES, authenticate, requireRole("ADMIN", "FINANCIAL_OFFICER"), listAll);
router.get(
  ROUTES.ADMIN.DISPUTE_BY_REFERENCE,
  authenticate,
  requireRole("ADMIN", "FINANCIAL_OFFICER"),
  getForStaff
);
router.patch(
  ROUTES.ADMIN.DISPUTE_BY_REFERENCE,
  authenticate,
  requireRole("ADMIN", "FINANCIAL_OFFICER"),
  validate(updateDisputeSchema),
  update
);

module.exports = router;
