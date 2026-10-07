const router = require("express").Router();

const ROUTES = require("../../constants/routes");
const validate = require("../../middlewares/validate");
const authenticate = require("../../middlewares/authenticate");
const { authLimiter } = require("../../middlewares/rateLimiter");
const authController = require("./auth.controller");
const {
  registerSchema,
  loginSchema,
  verifyEmailSchema,
  resendOtpSchema,
  refreshSchema,
  logoutSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} = require("./auth.validation");

router.use(authLimiter);

router.post(ROUTES.AUTH.REGISTER, validate(registerSchema), authController.register);

router.post(ROUTES.AUTH.LOGIN, validate(loginSchema), authController.login);

router.get(ROUTES.AUTH.ME, authenticate, authController.me);

router.post(ROUTES.AUTH.VERIFY_EMAIL, validate(verifyEmailSchema), authController.verifyEmail);

router.post(ROUTES.AUTH.RESEND_OTP, validate(resendOtpSchema), authController.resendOtp);

router.post(ROUTES.AUTH.REFRESH, validate(refreshSchema), authController.refresh);

router.post(ROUTES.AUTH.LOGOUT, validate(logoutSchema), authController.logout);

router.post(ROUTES.AUTH.FORGOT_PASSWORD, validate(forgotPasswordSchema), authController.forgotPassword);

router.post(ROUTES.AUTH.RESET_PASSWORD, validate(resetPasswordSchema), authController.resetPassword);

module.exports = router;
