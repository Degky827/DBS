const router = require("express").Router();

const ROUTES = require("../../constants/routes");
const validate = require("../../middlewares/validate");
const authenticate = require("../../middlewares/authenticate");
const { authLimiter } = require("../../middlewares/rateLimiter");
const profileController = require("./profile.controller");
const {
  updateProfileSchema,
  changePasswordSchema,
} = require("./profile.validation");

router.get(
  ROUTES.PROFILE.ME,
  authenticate,
  profileController.getMyProfile
);

router.patch(
  ROUTES.PROFILE.ME,
  authenticate,
  validate(updateProfileSchema),
  profileController.updateMyProfile
);

router.patch(
  ROUTES.PROFILE.ME_PASSWORD,
  authenticate,
  authLimiter,
  validate(changePasswordSchema),
  profileController.changeMyPassword
);

module.exports = router;
