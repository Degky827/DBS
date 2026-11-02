const ApiResponse = require("../utils/ApiResponse");
const { verifyDiditWebhook } = require("../utils/diditWebhookSignature");
const verificationService = require("../services/verificationService");
const metrics = require("../utils/metrics");

const REJECTED_CODES = new Set(["INVALID_WEBHOOK_SIGNATURE", "INVALID_WEBHOOK_TIMESTAMP"]);

const webhookOutcome = (result) => {
  if (result.duplicate) return "duplicate";
  if (result.applied) return "applied";
  if (result.ignoredReason) return "ignored";
  return "accepted";
};

async function receiveDidit(req, res, next) {
  try {
    const { event, authenticationMethod } = verifyDiditWebhook(req.body, req.headers);
    const result = await verificationService.processWebhook(event, authenticationMethod);
    metrics.recordKycWebhook(webhookOutcome(result));
    return ApiResponse.success(res, result, "Webhook accepted", 202);
  } catch (error) {
    metrics.recordKycWebhook(REJECTED_CODES.has(error?.code) ? "rejected" : "error");
    return next(error);
  }
}

module.exports = { receiveDidit };
