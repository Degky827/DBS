const router = require("express").Router();

const env = require("../../config/env");
const healthRoutes = require("./health.routes");
const docsRoutes = require("./docs.routes");
const submissionRoutes = require("./submission.routes");
const documentRoutes = require("./document.routes");
const reviewController = require("../../controllers/reviewController");
const authenticate = require("../../middlewares/authenticate");
const requireOfficer = require("../../middlewares/requireOfficer");
const validate = require("../../middlewares/validate");
const { reviewDecisionSchema } = require("../../validators/review.validation");

router.use("/", healthRoutes);

if (env.ENABLE_API_DOCS) {
  router.use(docsRoutes);
}

router.use("/", submissionRoutes);
router.use("/", documentRoutes);
router.get("/officer/reviews", authenticate, requireOfficer, reviewController.queue);
router.post(
  "/officer/submissions/:submissionId/decision",
  authenticate,
  requireOfficer,
  validate(reviewDecisionSchema),
  reviewController.decide
);

module.exports = router;
