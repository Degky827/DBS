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
} = require("./auth.validation");

router.use(authLimiter);

router.post(ROUTES.AUTH.REGISTER, validate(registerSchema), authController.register);

router.post(ROUTES.AUTH.LOGIN, validate(loginSchema), authController.login);

router.get(ROUTES.AUTH.ME, authenticate, authController.me);

router.post(ROUTES.AUTH.VERIFY_EMAIL, validate(verifyEmailSchema), authController.verifyEmail);

router.post(ROUTES.AUTH.RESEND_OTP, validate(resendOtpSchema), authController.resendOtp);

module.exports = router;
