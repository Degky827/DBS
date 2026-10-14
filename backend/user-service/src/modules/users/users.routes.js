const router = require("express").Router();

const ROUTES = require("../../constants/routes");
const validate = require("../../middlewares/validate");
const authenticate = require("../../middlewares/authenticate");
const { authLimiter } = require("../../middlewares/rateLimiter");
const usersController = require("./users.controller");
const {
  updateProfileSchema,
  changePasswordSchema,
} = require("./users.validation");

router.get(ROUTES.USERS.ME, authenticate, usersController.getMyProfile);

router.patch(
  ROUTES.USERS.ME,
  authenticate,
  validate(updateProfileSchema),
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
