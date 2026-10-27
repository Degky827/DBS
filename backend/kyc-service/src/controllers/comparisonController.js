const comparisonService = require("../services/comparisonService");
const ApiResponse = require("../utils/ApiResponse");

async function compare(req, res) {
  const result = await comparisonService.compareSubmission(
    req.user.id,
    req.headers.authorization,
    req.params.submissionId
  );
  return ApiResponse.success(res, result, "Profile comparison completed");
}

module.exports = { compare };
