const router = require("express").Router();

const authenticate = require("../../middlewares/authenticate");
const requireActiveAccount = require("../../middlewares/requireActiveAccount");
const documentUpload = require("../../middlewares/documentUpload");
const { uploadLimiter } = require("../../middlewares/rateLimiter");
const validate = require("../../middlewares/validate");
const documentController = require("../../controllers/documentController");
const { uploadDocumentSchema, correctionSchema } = require("../../validators/document.validation");

router.post(
  "/submissions/:submissionId/documents",
  authenticate,
  requireActiveAccount,
  uploadLimiter,
  documentUpload.single("document"),
  validate(uploadDocumentSchema),
  documentController.upload
);
router.get("/documents/:documentId", authenticate, documentController.get);
router.get("/documents/:documentId/content", authenticate, documentController.content);
router.patch(
  "/documents/:documentId/corrections",
  authenticate,
  requireActiveAccount,
  validate(correctionSchema),
  documentController.correct
);
router.delete(
  "/documents/:documentId",
  authenticate,
  requireActiveAccount,
  documentController.remove
);

module.exports = router;
