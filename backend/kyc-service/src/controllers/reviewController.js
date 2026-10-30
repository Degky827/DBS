const reviewService = require("../services/reviewService");
const ApiResponse = require("../utils/ApiResponse");

async function queue(req, res) {
  const result = await reviewService.getQueue(req.reviewQuery);
  return ApiResponse.success(res, result, "Review queue fetched");
}

async function stats(req, res) {
  const result = await reviewService.getStats();
  return ApiResponse.success(res, result, "Review statistics fetched");
}

async function get(req, res) {
  const result = await reviewService.getSubmission(req.params.submissionId);
  return ApiResponse.success(res, result, "KYC submission fetched");
}

async function decide(req, res) {
  const result = await reviewService.decide({
    submissionId: req.params.submissionId,
    reviewerId: req.user.id,
    decision: req.body.decision,
    reason: req.body.reason,
  });
  return ApiResponse.success(res, result, "Review decision recorded");
}

module.exports = { queue, stats, get, decide };
