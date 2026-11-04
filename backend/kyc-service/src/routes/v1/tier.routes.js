const router = require("express").Router();

const authenticate = require("../../middlewares/authenticate");
const requireActiveAccount = require("../../middlewares/requireActiveAccount");
const requireOfficer = require("../../middlewares/requireOfficer");
const requireRole = require("../../middlewares/requireRole");
const validate = require("../../middlewares/validate");
const validateQuery = require("../../middlewares/validateQuery");
const validateParams = require("../../middlewares/validateParams");
const tierController = require("../../controllers/tierController");
const {
  tierIdParamsSchema,
  assignmentParamsSchema,
  createTierSchema,
  updateTierLimitsSchema,
  tierRequestSchema,
  tierDecisionSchema,
  tierRequestQueueSchema,
  tierAssignmentHistorySchema,
} = require("../../validators/tier.validation");

const { submissionParamsSchema } = require("../../validators/params.validation");

router.get("/tiers", authenticate, tierController.list);
router.get("/tiers/current", authenticate, tierController.current);
router.post(
  "/tiers/requests",
  authenticate,
  requireActiveAccount,
  validate(tierRequestSchema),
  tierController.createRequest
);
router.get("/tiers/requests", authenticate, tierController.myRequests);

router.get(
  "/officer/tier-requests",
  authenticate,
  requireOfficer,
  validateQuery(tierRequestQueueSchema),
  tierController.requestQueue
);
router.get(
  "/officer/submissions/:submissionId/qualification",
  authenticate,
  requireOfficer,
  validateParams(submissionParamsSchema),
  tierController.qualification
);
router.post(
  "/officer/tier-requests/:assignmentId/decision",
  authenticate,
  requireOfficer,
  validateParams(assignmentParamsSchema),
  validate(tierDecisionSchema),
  tierController.decideRequest
);

router.get("/admin/tiers", authenticate, requireRole("ADMIN"), tierController.definitions);
router.get(
  "/admin/tier-assignments",
  authenticate,
  requireRole("ADMIN"),
  validateQuery(tierAssignmentHistorySchema),
  tierController.assignments
);
router.post(
  "/admin/tiers",
  authenticate,
  requireRole("ADMIN"),
  validate(createTierSchema),
  tierController.createVersion
);
router.post(
  "/admin/tiers/:tierId/activate",
  authenticate,
  requireRole("ADMIN"),
  validateParams(tierIdParamsSchema),
  tierController.activate
);
router.post(
  "/admin/tiers/:tierId/retire",
  authenticate,
  requireRole("ADMIN"),
  validateParams(tierIdParamsSchema),
  tierController.retire
);
router.put(
  "/admin/tiers/:tierId/limits",
  authenticate,
  requireRole("ADMIN"),
  validateParams(tierIdParamsSchema),
  validate(updateTierLimitsSchema),
  tierController.updateLimits
);

module.exports = router;
