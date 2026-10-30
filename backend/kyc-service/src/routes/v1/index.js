const router = require("express").Router();

const env = require("../../config/env");
const healthRoutes = require("./health.routes");
const docsRoutes = require("./docs.routes");
const submissionRoutes = require("./submission.routes");
const documentRoutes = require("./document.routes");
const officerDocumentRoutes = require("./officerDocument.routes");
const internalRoutes = require("./internal.routes");
const reviewController = require("../../controllers/reviewController");
const authenticate = require("../../middlewares/authenticate");
const requireOfficer = require("../../middlewares/requireOfficer");
const validate = require("../../middlewares/validate");
const validateQuery = require("../../middlewares/validateQuery");
const validateParams = require("../../middlewares/validateParams");
const { submissionParamsSchema } = require("../../validators/params.validation");
const {
  reviewDecisionSchema,
  reviewQueueSchema,
} = require("../../validators/review.validation");

router.use("/", healthRoutes);

if (env.ENABLE_API_DOCS) {
  router.use(docsRoutes);
}

router.use("/", submissionRoutes);
router.use("/", documentRoutes);
router.use("/", officerDocumentRoutes);
router.use("/", internalRoutes);
router.get(
  "/officer/reviews/stats",
  authenticate,
  requireOfficer,
  reviewController.stats
);
router.get(
  "/officer/reviews",
  authenticate,
  requireOfficer,
  validateQuery(reviewQueueSchema),
  reviewController.queue
);
router.get(
  "/officer/submissions/:submissionId",
  authenticate,
  requireOfficer,
  validateParams(submissionParamsSchema),
  reviewController.get
);
router.post(
  "/officer/submissions/:submissionId/decision",
  authenticate,
  requireOfficer,
  validate(reviewDecisionSchema),
  reviewController.decide
);

module.exports = router;
