const router = require("express").Router();

const ApiResponse = require("../../utils/ApiResponse");
const ROUTES = require("../../constants/routes");
const authenticate = require("../../middlewares/authenticate");
const requireActiveAccount = require("../../middlewares/requireActiveAccount");
const validate = require("../../middlewares/validate");
const usersService = require("../users/users.service");
const beneficiaries = require("./beneficiaries.service");
const { createBeneficiarySchema, updateBeneficiarySchema } = require("./beneficiaries.validation");

const list = async (req, res) => {
  const userId = await usersService.getResolvedUserId(req.user);
  const result = await beneficiaries.listBeneficiaries(userId);
  return ApiResponse.success(res, result, "Beneficiaries fetched");
};

const create = async (req, res) => {
  const userId = await usersService.getResolvedUserId(req.user);
  const result = await beneficiaries.createBeneficiary(userId, req.body);
  return ApiResponse.success(res, result, "Beneficiary saved", 201);
};

const update = async (req, res) => {
  const userId = await usersService.getResolvedUserId(req.user);
  const result = await beneficiaries.updateBeneficiary(userId, req.params.beneficiaryId, req.body);
  return ApiResponse.success(res, result, "Beneficiary updated");
};

const remove = async (req, res) => {
  const userId = await usersService.getResolvedUserId(req.user);
  const result = await beneficiaries.deleteBeneficiary(userId, req.params.beneficiaryId);
  return ApiResponse.success(res, result, "Beneficiary removed");
};

router.get(ROUTES.BENEFICIARIES.ROOT, authenticate, list);
router.post(
  ROUTES.BENEFICIARIES.ROOT,
  authenticate,
  requireActiveAccount,
  validate(createBeneficiarySchema),
  create
);
router.patch(
  ROUTES.BENEFICIARIES.BY_ID,
  authenticate,
  requireActiveAccount,
  validate(updateBeneficiarySchema),
  update
);
router.delete(ROUTES.BENEFICIARIES.BY_ID, authenticate, requireActiveAccount, remove);

module.exports = router;
