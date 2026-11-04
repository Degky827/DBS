const routes = {
  HEALTH: "/health",
  READY: "/ready",
  NOTIFICATIONS: {
    ROOT: "/notifications",
    UNREAD_COUNT: "/notifications/unread-count",
    READ_ALL: "/notifications/read-all",
    READ: "/notifications/:notificationId/read",
  },
  INTERNAL: {
    EVENTS: "/internal/notifications/events",
  },
};

module.exports = routes;
