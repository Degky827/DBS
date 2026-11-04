const router = require("express").Router();

const ApiResponse = require("../../utils/ApiResponse");
const { parseQuery } = require("../../utils/query");
const ROUTES = require("../../constants/routes");
const authenticate = require("../../middlewares/authenticate");
const requireActiveAccount = require("../../middlewares/requireActiveAccount");
const requireKycApproval = require("../../middlewares/requireKycApproval");
const validate = require("../../middlewares/validate");
const usersService = require("../users/users.service");
const scheduled = require("./scheduledTransfers.service");
const { createScheduleSchema, listSchedulesSchema } = require("./scheduledTransfers.validation");

const listSchedules = async (req, res) => {
  const query = parseQuery(listSchedulesSchema, req.query);
  const userId = await usersService.getResolvedUserId(req.user);
  const result = await scheduled.listSchedules(userId, query);
  return ApiResponse.success(res, result, "Scheduled transfers fetched");
};

const createSchedule = async (req, res) => {
  const userId = await usersService.getResolvedUserId(req.user);
  const result = await scheduled.createSchedule({
    userId,
    ...req.body,
    kyc: req.kyc,
  });
  return ApiResponse.success(res, result, "Scheduled transfer created", 201);
};

const getSchedule = async (req, res) => {
  const userId = await usersService.getResolvedUserId(req.user);
  const result = await scheduled.getSchedule(userId, req.params.scheduleId);
  return ApiResponse.success(res, result, "Scheduled transfer fetched");
};

const actionHandler = (action) => async (req, res) => {
  const userId = await usersService.getResolvedUserId(req.user);
  const result = await scheduled[`${action}Schedule`]({
    userId,
    scheduleId: req.params.scheduleId,
    actorId: userId,
    kyc: req.kyc,
  });
  const pastTense = { pause: "paused", resume: "resumed", cancel: "cancelled" }[action];
  return ApiResponse.success(res, result, `Scheduled transfer ${pastTense}`);
};

router.post(
  ROUTES.SCHEDULED_TRANSFERS.ROOT,
  authenticate,
  requireActiveAccount,
  requireKycApproval,
  validate(createScheduleSchema),
  createSchedule
);
router.get(ROUTES.SCHEDULED_TRANSFERS.ROOT, authenticate, listSchedules);
router.get(ROUTES.SCHEDULED_TRANSFERS.BY_ID, authenticate, getSchedule);
router.post(
  ROUTES.SCHEDULED_TRANSFERS.PAUSE,
  authenticate,
  requireActiveAccount,
  actionHandler("pause")
);
// Only resuming is gated. Pausing or cancelling a schedule is always allowed,
// including for a customer whose verification has lapsed: stopping money from
// moving must never require an approval.
router.post(
  ROUTES.SCHEDULED_TRANSFERS.RESUME,
  authenticate,
  requireActiveAccount,
  requireKycApproval,
  actionHandler("resume")
);
router.post(
  ROUTES.SCHEDULED_TRANSFERS.CANCEL,
  authenticate,
  requireActiveAccount,
  actionHandler("cancel")
);

module.exports = router;
