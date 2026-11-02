const router = require("express").Router();

const ROUTES = require("../../constants/routes");
const validate = require("../../middlewares/validate");
const authenticate = require("../../middlewares/authenticate");
const requireTrustedOrigin = require("../../middlewares/requireTrustedOrigin");
const { sensitiveAuthLimiter } = require("../../middlewares/rateLimiter");
const controller = require("./mfa.controller");
const {
  confirmSchema,
  verifySchema,
  stepUpSchema,
  disableSchema,
} = require("./mfa.validation");

router.get(ROUTES.AUTH.MFA, authenticate, controller.getStatus);

router.post(
  ROUTES.AUTH.MFA_SETUP,
  authenticate,
  sensitiveAuthLimiter,
  controller.beginSetup
);

router.post(
  ROUTES.AUTH.MFA_SETUP_CONFIRM,
  authenticate,
  sensitiveAuthLimiter,
  validate(confirmSchema),
  controller.confirmSetup
);

router.post(
  ROUTES.AUTH.MFA_DISABLE,
  authenticate,
  sensitiveAuthLimiter,
  validate(disableSchema),
  controller.disable
);

// Completes a password-only login challenge. The challenge token is the only
// credential here, so the trusted-origin check protects the cookie being set.
router.post(
  ROUTES.AUTH.MFA_VERIFY,
  sensitiveAuthLimiter,
  requireTrustedOrigin,
  validate(verifySchema),
  controller.verifyLogin
);

router.post(
  ROUTES.AUTH.MFA_STEP_UP,
  authenticate,
  sensitiveAuthLimiter,
  validate(stepUpSchema),
  controller.stepUp
);

module.exports = router;
