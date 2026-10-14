const authService = require("./auth.service");
const ApiResponse = require("../../utils/ApiResponse");

const devLogin = async (req, res) => {
  const result = await authService.devLogin(req.body);
  return ApiResponse.success(res, result, "Development session created");
};

const devLogout = async (req, res) => {
  const result = await authService.devLogout(req);
  return ApiResponse.success(res, null, result.message);
};

module.exports = { devLogin, devLogout };
