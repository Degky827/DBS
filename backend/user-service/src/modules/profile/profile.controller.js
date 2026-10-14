const profileService = require("./profile.service");
const ApiResponse = require("../../utils/ApiResponse");

const getMyProfile = async (req, res) => {
  const result = await profileService.getMyProfile(req.user.id);
  return ApiResponse.success(res, result, "Profile fetched");
};

const updateMyProfile = async (req, res) => {
  const result = await profileService.updateMyProfile(req.user.id, req.body);
  return ApiResponse.success(res, result, "Profile updated");
};

const changeMyPassword = async (req, res) => {
  const result = await profileService.changeMyPassword(
    req.user.id,
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
