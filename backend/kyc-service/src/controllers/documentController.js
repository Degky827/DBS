const documentService = require("../services/documentService");
const ApiResponse = require("../utils/ApiResponse");
const { setPrivateDocumentHeaders } = require("../utils/documentHeaders");

async function upload(req, res) {
  const document = await documentService.uploadDocument({
    userId: req.user.id,
    submissionId: req.params.submissionId,
    file: req.file,
    documentType: req.body.documentType,
    side: req.body.side,
  });
  return ApiResponse.success(res, document, "Document uploaded and OCR processed", 201);
}

async function get(req, res) {
  const document = await documentService.getDocument(req.user.id, req.params.documentId);
  delete document.storageKey;
  delete document.submission;
  return ApiResponse.success(res, document, "Extracted document data fetched");
}

async function content(req, res) {
  const result = await documentService.getDocumentContent(req.user.id, req.params.documentId);
  setPrivateDocumentHeaders(res);
  return res.type(result.mimeType).send(result.content);
}

async function correct(req, res) {
  const result = await documentService.correctFields(
    req.user.id,
    req.params.documentId,
    req.body.fields
  );
  return ApiResponse.success(res, result, "Extracted fields corrected");
}

async function remove(req, res) {
  await documentService.deleteDocument(req.user.id, req.params.documentId);
  return ApiResponse.success(res, null, "Document deleted");
}

module.exports = { upload, get, content, correct, remove };
