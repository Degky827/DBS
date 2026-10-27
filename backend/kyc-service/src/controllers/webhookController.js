const ApiResponse = require("../utils/ApiResponse");
const { verifyDiditWebhook } = require("../utils/diditWebhookSignature");
const verificationService = require("../services/verificationService");

async function receiveDidit(req, res, next) {
  try {
    const { event, authenticationMethod } = verifyDiditWebhook(req.body, req.headers);
    const result = await verificationService.processWebhook(event, authenticationMethod);
    return ApiResponse.success(res, result, "Webhook accepted", 202);
  } catch (error) {
    return next(error);
  }
}

module.exports = { receiveDidit };
