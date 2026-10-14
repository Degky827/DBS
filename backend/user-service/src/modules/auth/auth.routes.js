const router = require("express").Router();

const ROUTES = require("../../constants/routes");
const validate = require("../../middlewares/validate");
const authenticate = require("../../middlewares/authenticate");
const { authLimiter } = require("../../middlewares/rateLimiter");
const authController = require("./auth.controller");
const { devLoginSchema } = require("./auth.validation");

router.use(authLimiter);

router.post(
  ROUTES.AUTH.DEV_LOGIN,
  validate(devLoginSchema),
  authController.devLogin
);

router.post(ROUTES.AUTH.DEV_LOGOUT, authenticate, authController.devLogout);

module.exports = router;
