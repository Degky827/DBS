const prisma = require("../config/database");
const env = require("../config/env");
const logger = require("../config/logger");
const ApiError = require("../utils/ApiError");
const metrics = require("../utils/metrics");
const outbox = require("./outboxService");
const userServiceClient = require("./userServiceClient");
const { TASK_STATUS, OPEN_TASK_STATUSES, REASON } = require("../constants/kycTier");

const DAY_MS = 24 * 60 * 60 * 1000;

// Used when the tier the customer holds names no lead time. It only decides how
// early the customer is asked to act; the approval itself expires on its own
// date regardless of whether a task was ever created.
const DEFAULT_LEAD_DAYS = 30;

const taskSelect = {
  id: true,
  userId: true,
  submissionId: true,
  tierId: true,
  reason: true,
  status: true,
  dueAt: true,
  notifiedAt: true,
  completedAt: true,
  waivedBy: true,
  waiverReason: true,
  details: true,
  createdAt: true,
  updatedAt: true,
};

const isOpen = (status) => OPEN_TASK_STATUSES.includes(status);

const serializeTask = (task, now = new Date()) => ({
  id: task.id,
  userId: task.userId,
  submissionId: task.submissionId,
  tierId: task.tierId,
  reason: task.reason,
  status: task.status,
  dueAt: task.dueAt,
  notifiedAt: task.notifiedAt,
  completedAt: task.completedAt,
  waivedBy: task.waivedBy,
  waiverReason: task.waiverReason,
  details: task.details ?? {},
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
  isOverdue: isOpen(task.status) && task.dueAt.getTime() <= now.getTime(),
});

// A task is a prompt to act: it never downgrades, cancels or extends a tier on
// its own. Whether an approval is still usable is answered by
// utils/approval.js at read time, so a missed sweep cannot make an expired
// approval look valid.
const dueEntriesFor = (submission, now) => {
  const tier = submission.tier;
  const leadDays = tier?.reVerificationLeadDays ?? DEFAULT_LEAD_DAYS;
  const leadMs = Math.max(leadDays, 0) * DAY_MS;
  const entries = [];

  if (submission.approvalExpiresAt) {
    const isPast = submission.approvalExpiresAt.getTime() <= now.getTime();
    if (now.getTime() >= submission.approvalExpiresAt.getTime() - leadMs) {
      entries.push({
        reason: isPast ? REASON.APPROVAL_EXPIRED : REASON.APPROVAL_EXPIRING,
        dueAt: submission.approvalExpiresAt,
        details: { tierCode: tier?.code ?? null, leadDays },
      });
    }
  }

  if (tier?.reviewIntervalDays && submission.approvedAt) {
    const periodicDue = new Date(
      submission.approvedAt.getTime() + tier.reviewIntervalDays * DAY_MS
    );
    if (now.getTime() >= periodicDue.getTime() - leadMs) {
      entries.push({
        reason: REASON.PERIODIC_REVIEW,
        dueAt: periodicDue,
        details: { tierCode: tier.code, reviewIntervalDays: tier.reviewIntervalDays, leadDays },
      });
    }
  }

  const documents = Array.isArray(submission.documents) ? submission.documents : [];
  if (documents.length > 0) {
    const earliest = documents.reduce(
      (oldest, document) =>
        !oldest || document.expiresAt.getTime() < oldest.expiresAt.getTime() ? document : oldest,
      null
    );
    if (earliest && now.getTime() >= earliest.expiresAt.getTime() - leadMs) {
      const isPast = earliest.expiresAt.getTime() <= now.getTime();
      entries.push({
        reason: isPast ? REASON.DOCUMENT_EXPIRED : REASON.DOCUMENT_EXPIRING,
        dueAt: earliest.expiresAt,
        details: {
          documentId: earliest.id,
          documentType: earliest.documentType,
          tierCode: tier?.code ?? null,
          leadDays,
        },
      });
    }
  }

  return entries;
};

const createTask = async (entry) => {
  try {
    return await prisma.kycReVerificationTask.create({
      data: {
        userId: entry.userId,
        submissionId: entry.submissionId,
        tierId: entry.tierId,
        reason: entry.reason,
        status: TASK_STATUS.OPEN,
        dueAt: entry.dueAt,
        details: entry.details,
      },
      select: taskSelect,
    });
  } catch (error) {
    // One open task per reason and due date is the point of the unique index:
    // a sweep that runs every cycle must not bury the officer queue in
    // duplicates of the same request.
    if (error && error.code === "P2002") return null;
    throw error;
  }
};

const describeTask = (task) => {
  switch (task.reason) {
    case REASON.APPROVAL_EXPIRED:
      return "Your KYC approval has expired";
    case REASON.APPROVAL_EXPIRING:
      return "Your KYC approval expires soon";
    case REASON.DOCUMENT_EXPIRED:
      return "Your identity document has expired";
    case REASON.DOCUMENT_EXPIRING:
      return "Your identity document expires soon";
    case REASON.PERIODIC_REVIEW:
      return "Your periodic KYC review is due";
    case REASON.SCREENING_FOLLOW_UP:
      return "Your KYC review needs additional screening follow-up";
    default:
      return "Your KYC details need attention";
  }
};

// Only a task whose reminder was actually written to the outbox is marked as
// notified. When delivery is switched off the task stays OPEN, so the queue is
// still accurate about what the customer has not been told.
const notifyCustomer = async (task, now) => {
  if (!outbox.isEnabled()) return { task, enqueued: false };

  let contact;
  try {
    contact = await userServiceClient.getContact(task.userId);
  } catch (error) {
    logger.warn(
      { taskId: task.id, userId: task.userId, error: error.message },
      "Re-verification reminder skipped: contact lookup failed"
    );
    return { task, enqueued: false };
  }

  const event = await outbox.enqueue(prisma, {
    // The task id is stable, so a re-run cannot produce a second reminder for
    // the same request even if the first acknowledgement was lost.
    eventId: task.id,
    type: "kyc.reverification.due",
    aggregateType: "KYC_REVERIFICATION_TASK",
    aggregateId: task.id,
    occurredAt: now,
    payload: {
      taskId: task.id,
      reason: task.reason,
      dueAt: task.dueAt.toISOString(),
      title: describeTask(task),
      user: {
        userId: contact.userId,
        email: contact.email,
        name: contact.name,
      },
    },
  });

  if (!event) return { task, enqueued: false };

  const notified = await prisma.kycReVerificationTask.update({
    where: { id: task.id },
    data: {
      status: task.status === TASK_STATUS.OPEN ? TASK_STATUS.NOTIFIED : task.status,
      notifiedAt: now,
    },
    select: taskSelect,
  });
  return { task: notified, enqueued: true };
};

const sweep = async ({ now = new Date(), limit = env.KYC_REVERIFICATION_BATCH_SIZE } = {}) => {
  const summary = { scanned: 0, created: 0, notified: 0, completed: 0, overdue: 0, failed: 0 };

  try {
    const candidates = await prisma.kycSubmission.findMany({
      where: {
        status: "APPROVED",
        approvedAt: { not: null },
        revokedAt: null,
      },
      orderBy: [{ approvedAt: "asc" }, { id: "asc" }],
      take: limit,
      select: {
        id: true,
        userId: true,
        approvedAt: true,
        approvalExpiresAt: true,
        tierId: true,
        tier: {
          select: { code: true, reviewIntervalDays: true, reVerificationLeadDays: true },
        },
        documents: {
          where: { expiresAt: { not: null } },
          select: { id: true, documentType: true, expiresAt: true },
        },
      },
    });

    summary.scanned = candidates.length;

    for (const submission of candidates) {
      // An approval recorded after a task was opened is the evidence the task
      // was asking for, so the task closes without an officer touching it.
      const closed = await prisma.kycReVerificationTask.updateMany({
        where: {
          userId: submission.userId,
          submissionId: { not: submission.id },
          status: { in: OPEN_TASK_STATUSES },
          createdAt: { lt: submission.approvedAt },
        },
        data: { status: TASK_STATUS.COMPLETED, completedAt: now },
      });
      summary.completed += closed.count;

      for (const entry of dueEntriesFor(submission, now)) {
        const task = await createTask({
          userId: submission.userId,
          submissionId: submission.id,
          tierId: submission.tierId,
          ...entry,
        });
        if (!task) continue;

        summary.created += 1;
        const result = await notifyCustomer(task, now);
        if (result.enqueued) summary.notified += 1;
      }
    }

    const overdue = await prisma.kycReVerificationTask.updateMany({
      where: { status: { in: [TASK_STATUS.OPEN, TASK_STATUS.NOTIFIED] }, dueAt: { lt: now } },
      data: { status: TASK_STATUS.OVERDUE },
    });
    summary.overdue = overdue.count;

    const counts = await prisma.kycReVerificationTask.groupBy({
      by: ["reason"],
      where: { status: { in: OPEN_TASK_STATUSES } },
      _count: { _all: true },
    });
    metrics.setReVerificationOpenTasks(
      Object.fromEntries(counts.map((row) => [row.reason, row._count._all]))
    );

    metrics.recordReVerificationRun("success");
    metrics.setReVerificationLastRun(now);
    logger.info(summary, "KYC re-verification sweep completed");
    return summary;
  } catch (error) {
    summary.failed += 1;
    metrics.recordReVerificationRun("failed");
    logger.error({ error: error.message }, "KYC re-verification sweep failed");
    throw error;
  }
};

async function listTasks({ userId, status, limit = 50, now = new Date() } = {}) {
  const where = {
    ...(userId ? { userId } : {}),
    ...(status ? { status } : {}),
  };
  const tasks = await prisma.kycReVerificationTask.findMany({
    where,
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    take: limit,
    select: taskSelect,
  });
  return tasks.map((task) => serializeTask(task, now));
}

async function officerQueue({ status, reason, overdueOnly = false, limit = 50 } = {}) {
  const now = new Date();
  const where = {
    ...(status ? { status } : {}),
    ...(reason ? { reason } : {}),
    ...(overdueOnly ? { status: { in: OPEN_TASK_STATUSES }, dueAt: { lt: now } } : {}),
  };
  const tasks = await prisma.kycReVerificationTask.findMany({
    where,
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    take: limit,
    select: taskSelect,
  });
  return tasks.map((task) => serializeTask(task, now));
}

async function taskStats() {
  const now = new Date();
  const [byStatus, byReason, overdue] = await Promise.all([
    prisma.kycReVerificationTask.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.kycReVerificationTask.groupBy({
      by: ["reason"],
      where: { status: { in: OPEN_TASK_STATUSES } },
      _count: { _all: true },
    }),
    prisma.kycReVerificationTask.count({
      where: { status: { in: OPEN_TASK_STATUSES }, dueAt: { lt: now } },
    }),
  ]);

  return {
    byStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
    openByReason: Object.fromEntries(byReason.map((row) => [row.reason, row._count._all])),
    overdue,
  };
}

// Waiving records that the request was consciously dropped; it does not extend
// the approval, so an expired approval stays unusable even after a waiver.
async function waiveTask({ taskId, actorId, reason }) {
  const task = await prisma.kycReVerificationTask.findUnique({
    where: { id: taskId },
    select: taskSelect,
  });
  if (!task) {
    throw ApiError.notFound("Re-verification task not found", "TASK_NOT_FOUND");
  }
  if (!isOpen(task.status)) {
    throw ApiError.conflict("Only an open re-verification task can be waived", "TASK_NOT_OPEN");
  }

  const updated = await prisma.kycReVerificationTask.update({
    where: { id: taskId },
    data: {
      status: TASK_STATUS.WAIVED,
      waivedBy: actorId,
      waiverReason: reason,
      completedAt: new Date(),
    },
    select: taskSelect,
  });
  return serializeTask(updated);
}

module.exports = {
  DAY_MS,
  DEFAULT_LEAD_DAYS,
  describeTask,
  dueEntriesFor,
  serializeTask,
  sweep,
  listTasks,
  officerQueue,
  taskStats,
  waiveTask,
};
