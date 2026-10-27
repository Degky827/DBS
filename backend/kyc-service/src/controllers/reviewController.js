const reviewService = require("../services/reviewService");
const ApiResponse = require("../utils/ApiResponse");

async function queue(req, res) {
  const submissions = await reviewService.getQueue();
  return ApiResponse.success(res, submissions, "Review queue fetched");
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

module.exports = { queue, decide };
