const authService = require("./auth.service");
const ApiResponse = require("../../utils/ApiResponse");

const register = async (req, res) => {
  const result = await authService.register(req.body);
  return ApiResponse.success(res, result, "Registration successful", 201);
};

const login = async (req, res) => {
  const result = await authService.login(req.body);
  return ApiResponse.success(res, result, "Login successful");
};

const me = async (req, res) => {
  const result = await authService.getMe(req.user.sub);
  return ApiResponse.success(res, result, "Profile fetched");
};

const verifyEmail = async (req, res) => {
  const result = await authService.verifyEmail(req.body);
  return ApiResponse.success(res, result, "Email verified");
};

const resendOtp = async (req, res) => {
  const result = await authService.resendOtp(req.body);
  return ApiResponse.success(res, null, result.message);
};

module.exports = { register, login, me, verifyEmail, resendOtp };
