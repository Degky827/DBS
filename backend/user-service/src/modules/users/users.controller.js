const usersService = require("./users.service");
const ApiResponse = require("../../utils/ApiResponse");

const getMyProfile = async (req, res) => {
  const result = await usersService.getMyProfile(req.user);
  return ApiResponse.success(res, result, "Profile fetched");
};

const updateMyProfile = async (req, res) => {
  const result = await usersService.updateMyProfile(
    req.user,
    req.body,
    req.file
  );
  return ApiResponse.success(res, result, "Profile updated");
};

const changeMyPassword = async (req, res) => {
  const result = await usersService.changeMyPassword(
    req.user,
    req.body,
    req.session
  );
  return ApiResponse.success(res, null, result.message);
};

module.exports = {
  getMyProfile,
  updateMyProfile,
  changeMyPassword,
};
