const internalService = require("./internal.service");
const ApiResponse = require("../../utils/ApiResponse");

const changePassword = async (req, res) => {
  const result = await internalService.changePasswordForUser(req.body);
  return ApiResponse.success(res, null, result.message);
};

module.exports = { changePassword };
