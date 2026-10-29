const documentService = require("../services/documentService");
const ApiResponse = require("../utils/ApiResponse");
const { setPrivateDocumentHeaders } = require("../utils/documentHeaders");

async function list(req, res) {
  const result = await documentService.listSubmissionDocumentsForOfficer(
    req.user.id,
    req.params.submissionId
  );
  return ApiResponse.success(res, result, "Submission documents fetched");
}

async function get(req, res) {
  const document = await documentService.getDocumentForOfficer(
    req.user.id,
    req.params.documentId
  );
  return ApiResponse.success(res, document, "Document evidence metadata fetched");
}

async function content(req, res) {
  const result = await documentService.getDocumentContentForOfficer(
    req.user.id,
    req.params.documentId
  );
  setPrivateDocumentHeaders(res);
  return res.type(result.mimeType).send(result.content);
}

module.exports = { list, get, content };
