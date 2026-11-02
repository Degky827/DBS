const router = require("express").Router();

const authenticate = require("../../middlewares/authenticate");
const requireActiveAccount = require("../../middlewares/requireActiveAccount");
const validate = require("../../middlewares/validate");
const submissionController = require("../../controllers/submissionController");
const verificationController = require("../../controllers/verificationController");
const comparisonController = require("../../controllers/comparisonController");
const { createSubmissionSchema } = require("../../validators/submission.validation");

router.post(
  "/submissions",
  authenticate,
  requireActiveAccount,
  validate(createSubmissionSchema),
  submissionController.create
);
router.get("/status", authenticate, submissionController.getStatus);
router.post(
  "/submissions/:submissionId/verification-session",
  authenticate,
  requireActiveAccount,
  verificationController.createSession
);
router.post(
  "/submissions/:submissionId/compare",
  authenticate,
  requireActiveAccount,
  comparisonController.compare
);

module.exports = router;
