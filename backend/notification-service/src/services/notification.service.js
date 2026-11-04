const prisma = require("../config/database");
const env = require("../config/env");
const ApiError = require("../utils/ApiError");
const metrics = require("../utils/metrics");
const { buildNotifications } = require("./notificationTemplates");

const formatNotification = (notification) => ({
  id: notification.id,
  eventType: notification.eventType,
  title: notification.title,
  body: notification.body,
  data: notification.data,
  readAt: notification.readAt,
  createdAt: notification.createdAt,
});

const normalizeEmail = (email) =>
  String(email || "")
    .trim()
    .toLowerCase();

const requireEmail = (user) => {
  const email = normalizeEmail(user?.email);
  if (!email) {
    throw ApiError.unauthorized("Token missing email claim", "INVALID_TOKEN_SUBJECT");
  }
  return email;
};

const listNotifications = async (
  user,
  { limit = env.NOTIFICATION_PAGE_SIZE, cursor, unreadOnly = false, eventType } = {}
) => {
  const recipientEmail = requireEmail(user);
  const where = { recipientEmail };
  if (unreadOnly) where.readAt = null;
  if (eventType) where.eventType = eventType;

  if (cursor) {
    const existing = await prisma.notification.findFirst({
      where: { id: cursor, recipientEmail },
      select: { id: true },
    });
    if (!existing) {
      throw ApiError.badRequest("Notification cursor is invalid", "INVALID_NOTIFICATION_CURSOR");
    }
  }

  const rows = await prisma.notification.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);

  return {
    notifications: page.map(formatNotification),
    page: {
      limit,
      hasMore,
      nextCursor: hasMore ? page[page.length - 1].id : null,
    },
  };
};

const getUnreadCount = async (user) => {
  const recipientEmail = requireEmail(user);
  const count = await prisma.notification.count({
    where: { recipientEmail, readAt: null },
  });
  return { unreadCount: count };
};

const markRead = async (user, notificationId) => {
  const recipientEmail = requireEmail(user);
  const notification = await prisma.notification.findFirst({
    where: { id: notificationId, recipientEmail },
  });
  if (!notification) {
    throw ApiError.notFound("Notification not found", "NOTIFICATION_NOT_FOUND");
  }
  if (notification.readAt) {
    return { notification: formatNotification(notification), replayed: true };
  }

  const updated = await prisma.notification.update({
    where: { id: notification.id },
    data: { readAt: new Date() },
  });
  return { notification: formatNotification(updated), replayed: false };
};

const markAllRead = async (user) => {
  const recipientEmail = requireEmail(user);
  const result = await prisma.notification.updateMany({
    where: { recipientEmail, readAt: null },
    data: { readAt: new Date() },
  });
  return { updated: result.count };
};

// The outbox contract is at-least-once: the eventId is recorded in the same
// transaction as its notifications, so a redelivered event returns 409 and the
// dispatcher stops retrying it.
const consumeEvent = async ({ eventId, type, payload }) => {
  const items = buildNotifications(type, payload);

  const seen = new Set();
  const unique = items.filter((item) => {
    const key = `${item.recipientEmail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  try {
    const created = await prisma.$transaction(async (tx) => {
      const existing = await tx.processedEvent.findUnique({
        where: { eventId },
        select: { eventId: true },
      });
      if (existing) {
        throw ApiError.conflict("Event already processed", "EVENT_ALREADY_PROCESSED");
      }
      await tx.processedEvent.create({ data: { eventId, type } });

      if (unique.length === 0) return 0;

      const emailsQueued = unique.filter((item) => item.sendEmail).length;
      await tx.notification.createMany({
        data: unique.map((item) => ({
          eventId,
          eventType: type,
          recipientEmail: item.recipientEmail,
          userId: item.userId || null,
          title: item.title,
          body: item.body,
          data: item.data,
          emailStatus: env.EMAIL_ENABLED && item.sendEmail ? "PENDING" : "SKIPPED",
        })),
        skipDuplicates: true,
      });
      return emailsQueued;
    });

    metrics.recordEvent(type, "accepted");
    return {
      eventId,
      type,
      notificationsCreated: unique.length,
      emailsQueued: env.EMAIL_ENABLED ? created : 0,
      ignored: unique.length === 0,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      metrics.recordEvent(type, "duplicate");
      throw error;
    }
    if (error.code === "P2002") {
      metrics.recordEvent(type, "duplicate");
      throw ApiError.conflict("Event already processed", "EVENT_ALREADY_PROCESSED");
    }
    metrics.recordEvent(type, "failed");
    throw error;
  }
};

module.exports = {
  listNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
  consumeEvent,
};
