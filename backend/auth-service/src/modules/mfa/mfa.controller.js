const mfaService = require("./mfa.service");
const ApiResponse = require("../../utils/ApiResponse");
const { setRefreshCookie } = require("../../utils/cookie.util");

const getStatus = async (req, res) => {
  const result = await mfaService.getStatus(req.user.sub);
  return ApiResponse.success(res, result, "Multi-factor status fetched");
};

const beginSetup = async (req, res) => {
  const result = await mfaService.beginEnrollment(req.user.sub);
  return ApiResponse.success(res, result, "Multi-factor setup started");
};

const confirmSetup = async (req, res) => {
  const result = await mfaService.confirmEnrollment(req.user.sub, req.body);
  return ApiResponse.success(
    res,
    result,
    "Multi-factor authentication enabled. Store the recovery codes now."
  );
};

const disable = async (req, res) => {
  const result = await mfaService.disable(req.user.sub, req.body);
  return ApiResponse.success(res, result, "Multi-factor authentication disabled");
};

const verifyLogin = async (req, res) => {
  const { user, accessToken, refreshToken } = await mfaService.verifyLogin(
    req.body
  );
  setRefreshCookie(res, refreshToken);
  return ApiResponse.success(
    res,
    { user, accessToken },
    "Login successful"
  );
};

const stepUp = async (req, res) => {
  const result = await mfaService.stepUp({
    userId: req.user.sub,
    sessionId: req.user.sid,
    ...req.body,
  });
  return ApiResponse.success(res, result, "Step-up authentication successful");
};

module.exports = {
  getStatus,
  beginSetup,
  confirmSetup,
  disable,
  verifyLogin,
  stepUp,
};
