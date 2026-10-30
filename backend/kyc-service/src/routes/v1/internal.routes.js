const router = require("express").Router();

const authenticateInternal = require("../../middlewares/authenticateInternal");
const validateParams = require("../../middlewares/validateParams");
const internalController = require("../../controllers/internalController");
const { userParamsSchema } = require("../../validators/params.validation");

router.get(
  "/internal/users/:userId/status",
  authenticateInternal,
  validateParams(userParamsSchema),
  internalController.status
);

module.exports = router;
