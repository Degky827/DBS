const verificationService = require("../services/verificationService");
const ApiResponse = require("../utils/ApiResponse");

async function createSession(req, res) {
  const session = await verificationService.createSession(
    req.user.id,
    req.params.submissionId
  );
  return ApiResponse.success(res, session, "Verification session ready");
}

module.exports = { createSession };
