const router = require("express").Router();

const authenticate = require("../../middlewares/authenticate");
const requireOfficer = require("../../middlewares/requireOfficer");
const validate = require("../../middlewares/validate");
const validateQuery = require("../../middlewares/validateQuery");
const validateParams = require("../../middlewares/validateParams");
const controller = require("../../controllers/reVerificationController");
const {
  myTaskQuerySchema,
  officerTaskQueueSchema,
  taskIdParamsSchema,
  waiveTaskSchema,
} = require("../../validators/reverification.validation");

router.get(
  "/reverification/tasks",
  authenticate,
  validateQuery(myTaskQuerySchema),
  controller.myTasks
);

router.get(
  "/officer/reverification/tasks",
  authenticate,
  requireOfficer,
  validateQuery(officerTaskQueueSchema),
  controller.queue
);
router.get("/officer/reverification/stats", authenticate, requireOfficer, controller.stats);
router.post(
  "/officer/reverification/tasks/:taskId/waive",
  authenticate,
  requireOfficer,
  validateParams(taskIdParamsSchema),
  validate(waiveTaskSchema),
  controller.waive
);

module.exports = router;
