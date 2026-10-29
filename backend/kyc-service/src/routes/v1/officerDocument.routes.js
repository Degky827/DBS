const router = require("express").Router();

const authenticate = require("../../middlewares/authenticate");
const requireOfficer = require("../../middlewares/requireOfficer");
const validateParams = require("../../middlewares/validateParams");
const officerDocumentController = require("../../controllers/officerDocumentController");
const {
  submissionParamsSchema,
  documentParamsSchema,
} = require("../../validators/params.validation");

router.get(
  "/officer/submissions/:submissionId/documents",
  authenticate,
  requireOfficer,
  validateParams(submissionParamsSchema),
  officerDocumentController.list
);
router.get(
  "/officer/documents/:documentId",
  authenticate,
  requireOfficer,
  validateParams(documentParamsSchema),
  officerDocumentController.get
);
router.get(
  "/officer/documents/:documentId/content",
  authenticate,
  requireOfficer,
  validateParams(documentParamsSchema),
  officerDocumentController.content
);

module.exports = router;
