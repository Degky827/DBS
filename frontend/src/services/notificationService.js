import { notificationApi } from "./api";

const unwrap = (response) => response.data.data;

export const listNotifications = async ({ limit = 20, cursor, unreadOnly, eventType } = {}) =>
  unwrap(
    await notificationApi.get("/notifications", {
      params: {
        limit,
        ...(cursor ? { cursor } : {}),
        ...(unreadOnly ? { unreadOnly: true } : {}),
        ...(eventType ? { eventType } : {}),
      },
    })
  );

export const getUnreadNotificationCount = async () =>
  unwrap(await notificationApi.get("/notifications/unread-count"));

export const markNotificationRead = async (notificationId) =>
  unwrap(
    await notificationApi.post(`/notifications/${encodeURIComponent(notificationId)}/read`, {})
  );

export const markAllNotificationsRead = async () =>
  unwrap(await notificationApi.post("/notifications/read-all", {}));
