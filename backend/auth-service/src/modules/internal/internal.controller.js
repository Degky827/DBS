const internalService = require("./internal.service");
const ApiResponse = require("../../utils/ApiResponse");

const changePassword = async (req, res) => {
  const result = await internalService.changePasswordForUser(req.body);
  return ApiResponse.success(res, null, result.message);
};

const introspectToken = async (req, res) => {
  const result = await internalService.introspectAccessToken(req.body.token);
  return ApiResponse.success(res, result, "Token introspection result");
};

const updateAccountStatus = async (req, res) => {
  const result = await internalService.setAccountStatus(req.body);
  return ApiResponse.success(res, result, "Account status updated");
};

const getAccountStatuses = async (req, res) => {
  const result = await internalService.getAccountStatuses(req.body.emails);
  return ApiResponse.success(res, { users: result }, "Account statuses");
};

const closeAccount = async (req, res) => {
  const result = await internalService.closeAccountForUser(req.body);
  return ApiResponse.success(res, result, "Account closed");
};

const resetMfa = async (req, res) => {
  const result = await internalService.resetMfaForUser(req.body);
  return ApiResponse.success(res, result, "Multi-factor authentication reset");
};

module.exports = {
  changePassword,
  introspectToken,
  updateAccountStatus,
  getAccountStatuses,
  closeAccount,
  resetMfa,
};
