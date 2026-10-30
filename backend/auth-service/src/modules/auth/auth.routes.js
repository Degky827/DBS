const router = require("express").Router();

const ROUTES = require("../../constants/routes");
const validate = require("../../middlewares/validate");
const authenticate = require("../../middlewares/authenticate");
const requireTrustedOrigin = require("../../middlewares/requireTrustedOrigin");
const {
  loginLimiter,
  sensitiveAuthLimiter,
  refreshLimiter,
} = require("../../middlewares/rateLimiter");
const authController = require("./auth.controller");
const {
  registerSchema,
  loginSchema,
  verifyEmailSchema,
  resendOtpSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  notificationPreferencesSchema,
} = require("./auth.validation");

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  res.set("Pragma", "no-cache");
  next();
});

// Ordinary authenticated account reads use only the global limiter.
router.get(ROUTES.AUTH.ME, authenticate, authController.me);

router.get(
  ROUTES.AUTH.NOTIFICATION_PREFERENCES,
  authenticate,
  authController.getNotificationPreferences
);

router.patch(
  ROUTES.AUTH.NOTIFICATION_PREFERENCES,
  authenticate,
  validate(notificationPreferencesSchema),
  authController.updateNotificationPreferences
);

// Credential-adjacent endpoints receive stricter, purpose-specific budgets.
router.post(
  ROUTES.AUTH.REGISTER,
  sensitiveAuthLimiter,
  validate(registerSchema),
  authController.register
);

router.post(
  ROUTES.AUTH.LOGIN,
  loginLimiter,
  requireTrustedOrigin,
  validate(loginSchema),
  authController.login
);

router.post(
  ROUTES.AUTH.VERIFY_EMAIL,
  sensitiveAuthLimiter,
  validate(verifyEmailSchema),
  authController.verifyEmail
);

router.post(
  ROUTES.AUTH.RESEND_OTP,
  sensitiveAuthLimiter,
  validate(resendOtpSchema),
  authController.resendOtp
);

router.post(
  ROUTES.AUTH.FORGOT_PASSWORD,
  sensitiveAuthLimiter,
  validate(forgotPasswordSchema),
  authController.forgotPassword
);

router.post(
  ROUTES.AUTH.RESET_PASSWORD,
  sensitiveAuthLimiter,
  validate(resetPasswordSchema),
  authController.resetPassword
);

// Cookie-authenticated session endpoints: separate refresh budget and
// origin validation in addition to SameSite cookies.
router.post(
  ROUTES.AUTH.REFRESH,
  refreshLimiter,
  requireTrustedOrigin,
  authController.refresh
);

router.post(
  ROUTES.AUTH.LOGOUT,
  refreshLimiter,
  requireTrustedOrigin,
  authController.logout
);

module.exports = router;
