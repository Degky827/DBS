const router = require("express").Router();

const ROUTES = require("../../constants/routes");
const validate = require("../../middlewares/validate");
const authenticate = require("../../middlewares/authenticate");
const { authLimiter } = require("../../middlewares/rateLimiter");
const authController = require("./auth.controller");
const { registerSchema, loginSchema } = require("./auth.validation");

router.use(authLimiter);

router.post(ROUTES.AUTH.REGISTER, validate(registerSchema), authController.register);

router.post(ROUTES.AUTH.LOGIN, validate(loginSchema), authController.login);

router.get(ROUTES.AUTH.ME, authenticate, authController.me);

module.exports = router;
