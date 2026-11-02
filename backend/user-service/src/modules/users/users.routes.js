const router = require("express").Router();

const ROUTES = require("../../constants/routes");
const validate = require("../../middlewares/validate");
const authenticate = require("../../middlewares/authenticate");
const avatarUpload = require("../../middlewares/avatarUpload");
const requireActiveAccount = require("../../middlewares/requireActiveAccount");
const requireStepUp = require("../../middlewares/requireStepUp");
const { authLimiter } = require("../../middlewares/rateLimiter");
const usersController = require("./users.controller");
const {
  updateProfileSchema,
  changePasswordSchema,
  closeAccountSchema,
} = require("./users.validation");

const validateProfileUpdate = (req, res, next) => {
  if (req.file && Object.keys(req.body || {}).length === 0) {
    return next();
  }

  return validate(updateProfileSchema)(req, res, next);
};

router.get(ROUTES.USERS.ME, authenticate, usersController.getMyProfile);

router.patch(
  ROUTES.USERS.ME,
  authenticate,
  avatarUpload,
  validateProfileUpdate,
  usersController.updateMyProfile
);

router.patch(
  ROUTES.USERS.ME_PASSWORD,
  authenticate,
  authLimiter,
  validate(changePasswordSchema),
  usersController.changeMyPassword
);

// Irreversible self-service closure. Requires a settled wallet, fresh
// step-up when MFA is enrolled, and the current password.
router.delete(
  ROUTES.USERS.ME,
  authenticate,
  requireActiveAccount,
  requireStepUp,
  authLimiter,
  validate(closeAccountSchema),
  usersController.closeMyAccount
);

module.exports = router;
