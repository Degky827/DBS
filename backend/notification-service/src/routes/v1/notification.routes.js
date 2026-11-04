const router = require("express").Router();

const ROUTES = require("../../constants/routes");
const ApiResponse = require("../../utils/ApiResponse");
const { parseQuery } = require("../../utils/query");
const authenticate = require("../../middlewares/authenticate");
const validateParams = require("../../middlewares/validateParams");
const notifications = require("../../services/notification.service");
const {
  listQuerySchema,
  notificationIdSchema,
} = require("../../validators/notification.validation");

const list = async (req, res) => {
  const query = parseQuery(listQuerySchema, req.query);
  const result = await notifications.listNotifications(req.user, query);
  return ApiResponse.success(res, result, "Notifications fetched");
};

const unreadCount = async (req, res) => {
  const result = await notifications.getUnreadCount(req.user);
  return ApiResponse.success(res, result, "Unread notification count fetched");
};

const markRead = async (req, res) => {
  const result = await notifications.markRead(req.user, req.params.notificationId);
  return ApiResponse.success(
    res,
    result,
    result.replayed ? "Notification already read" : "Notification marked read"
  );
};

const markAllRead = async (req, res) => {
  const result = await notifications.markAllRead(req.user);
  return ApiResponse.success(res, result, "All notifications marked read");
};

router.get(ROUTES.NOTIFICATIONS.ROOT, authenticate, list);
router.get(ROUTES.NOTIFICATIONS.UNREAD_COUNT, authenticate, unreadCount);
router.post(ROUTES.NOTIFICATIONS.READ_ALL, authenticate, markAllRead);
router.post(
  ROUTES.NOTIFICATIONS.READ,
  authenticate,
  validateParams(notificationIdSchema),
  markRead
);

module.exports = router;
