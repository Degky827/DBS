const router = require("express").Router();

const ROUTES = require("../../constants/routes");
const validate = require("../../middlewares/validate");
const authenticateInternal = require("../../middlewares/authenticateInternal");
const internalController = require("./internal.controller");
const { changePasswordSchema } = require("./internal.validation");

router.post(
  ROUTES.INTERNAL.CHANGE_PASSWORD,
  authenticateInternal,
  validate(changePasswordSchema),
  internalController.changePassword
);

module.exports = router;
