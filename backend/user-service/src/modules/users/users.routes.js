const router = require("express").Router();

const ROUTES = require("../../constants/routes");
const validate = require("../../middlewares/validate");
const authenticate = require("../../middlewares/authenticate");
const avatarUpload = require("../../middlewares/avatarUpload");
const { authLimiter } = require("../../middlewares/rateLimiter");
const usersController = require("./users.controller");
const {
  updateProfileSchema,
  changePasswordSchema,
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

module.exports = router;
