const router = require("express").Router();

const ROUTES = require("../../constants/routes");
const ApiResponse = require("../../utils/ApiResponse");
const authenticateInternal = require("../../middlewares/authenticateInternal");
const validate = require("../../middlewares/validate");
const { internalLimiter } = require("../../middlewares/rateLimiter");
const notifications = require("../../services/notification.service");
const { eventSchema } = require("../../validators/notification.validation");

const consume = async (req, res) => {
  const result = await notifications.consumeEvent(req.body);
  return ApiResponse.success(res, result, "Event accepted", 202);
};

router.post(
  ROUTES.INTERNAL.EVENTS,
  internalLimiter,
  authenticateInternal,
  validate(eventSchema),
  consume
);

module.exports = router;
