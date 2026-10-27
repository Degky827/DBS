const submissionService = require("../services/submissionService");
const ApiResponse = require("../utils/ApiResponse");

async function create(req, res) {
  const submission = await submissionService.createSubmission(
    req.user.id,
    req.headers.authorization
  );
  return ApiResponse.success(res, submission, "KYC submission created", 201);
}

async function getStatus(req, res) {
  const submission = await submissionService.getCurrentStatus(req.user.id);
  return ApiResponse.success(res, submission, "KYC status fetched");
}

module.exports = { create, getStatus };
