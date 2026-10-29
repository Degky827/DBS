const submissionService = require("../services/submissionService");
const ApiResponse = require("../utils/ApiResponse");

async function status(req, res) {
  const result = await submissionService.getInternalStatus(req.params.userId);
  return ApiResponse.success(res, result, "KYC status fetched");
}

module.exports = { status };
