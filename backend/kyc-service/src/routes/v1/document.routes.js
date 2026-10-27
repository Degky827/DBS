const router = require("express").Router();

const authenticate = require("../../middlewares/authenticate");
const documentUpload = require("../../middlewares/documentUpload");
const { uploadLimiter } = require("../../middlewares/rateLimiter");
const validate = require("../../middlewares/validate");
const documentController = require("../../controllers/documentController");
const { uploadDocumentSchema, correctionSchema } = require("../../validators/document.validation");

router.post(
  "/submissions/:submissionId/documents",
  authenticate,
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
  validate(correctionSchema),
  documentController.correct
);
router.delete("/documents/:documentId", authenticate, documentController.remove);

module.exports = router;
