const authService = require("./auth.service");
const ApiResponse = require("../../utils/ApiResponse");
const ApiError = require("../../utils/ApiError");
const {
  readRefreshToken,
  setRefreshCookie,
  clearRefreshCookie,
} = require("../../utils/cookie.util");

const register = async (req, res) => {
  const result = await authService.register(req.body);
  return ApiResponse.success(res, result, "Registration successful", 201);
};

const login = async (req, res) => {
  const { user, accessToken, refreshToken } = await authService.login(req.body);
  setRefreshCookie(res, refreshToken);
  return ApiResponse.success(res, { user, accessToken }, "Login successful");
};

const me = async (req, res) => {
  const result = await authService.getMe(req.user.sub);
  return ApiResponse.success(res, result, "Profile fetched");
};

const getNotificationPreferences = async (req, res) => {
  const result = await authService.getNotificationPreferences(req.user.sub);
  return ApiResponse.success(res, result, "Notification preferences fetched");
};

const updateNotificationPreferences = async (req, res) => {
  const result = await authService.updateNotificationPreferences(
    req.user.sub,
    req.body
  );
  return ApiResponse.success(res, result, "Notification preferences updated");
};

const verifyEmail = async (req, res) => {
  const result = await authService.verifyEmail(req.body);
  return ApiResponse.success(res, result, "Email verified");
};

const resendOtp = async (req, res) => {
  const result = await authService.resendOtp(req.body);
  return ApiResponse.success(res, null, result.message);
};

const refresh = async (req, res) => {
  const refreshToken = readRefreshToken(req);
  if (!refreshToken) {
    clearRefreshCookie(res);
    throw ApiError.unauthorized("Refresh token is missing", "REFRESH_TOKEN_MISSING");
  }

  try {
    const result = await authService.refresh({ refreshToken });
    setRefreshCookie(res, result.refreshToken);
    return ApiResponse.success(
      res,
      { user: result.user, accessToken: result.accessToken },
      "Token refreshed"
    );
  } catch (error) {
    // REFRESH_RACE means another tab already rotated the cookie. Clearing it
    // would discard the successor token that the browser just received.
    if (error.code !== "REFRESH_RACE") clearRefreshCookie(res);
    throw error;
  }
};

const logout = async (req, res) => {
  const refreshToken = readRefreshToken(req);
  const result = await authService.logout(refreshToken);
  clearRefreshCookie(res);
  return ApiResponse.success(res, null, result.message);
};

const forgotPassword = async (req, res) => {
  const result = await authService.forgotPassword(req.body);
  return ApiResponse.success(res, null, result.message);
};

const resetPassword = async (req, res) => {
  const result = await authService.resetPassword(req.body);
  return ApiResponse.success(res, null, result.message);
};

module.exports = {
  register,
  login,
  me,
  getNotificationPreferences,
  updateNotificationPreferences,
  verifyEmail,
  resendOtp,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
};
