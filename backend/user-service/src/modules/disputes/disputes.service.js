const { Prisma } = require("@prisma/client");
const prisma = require("../../config/database");
const ApiError = require("../../utils/ApiError");
const audit = require("../../utils/audit");
const outbox = require("../outbox/outbox.service");
const { toAmountString } = require("../wallets/money");

const REASONS = new Set([
  "UNAUTHORIZED",
  "DUPLICATE_CHARGE",
  "NOT_RECEIVED",
  "INCORRECT_AMOUNT",
  "SERVICE_NOT_RECEIVED",
  "OTHER",
]);

const STATUSES = new Set(["OPEN", "UNDER_REVIEW", "RESOLVED", "REJECTED"]);
const OPEN_STATUSES = ["OPEN", "UNDER_REVIEW"];

const TRANSITIONS = Object.freeze({
  OPEN: ["UNDER_REVIEW", "RESOLVED", "REJECTED"],
  UNDER_REVIEW: ["RESOLVED", "REJECTED"],
  RESOLVED: [],
  REJECTED: [],
});

const formatEvent = (event) => ({
  id: event.id,
  type: event.type,
  note: event.note,
  actorUserId: event.actorUserId,
  createdAt: event.createdAt,
});

const formatDispute = (dispute) => ({
  id: dispute.id,
  reference: dispute.reference,
  status: dispute.status,
  reason: dispute.reason,
  description: dispute.description,
  resolution: dispute.resolution,
  resolvedAmount: dispute.resolvedAmount ? dispute.resolvedAmount.toFixed(2) : null,
  assignedTo: dispute.assignedTo,
  openedAt: dispute.openedAt,
  updatedAt: dispute.updatedAt,
  transaction: dispute.transaction
    ? {
        reference: dispute.transaction.reference,
        type: dispute.transaction.type,
        status: dispute.transaction.status,
        amount: dispute.transaction.amount.toFixed(2),
        currency: dispute.transaction.currency,
        createdAt: dispute.transaction.createdAt,
      }
    : undefined,
  ...(dispute.user
    ? {
        customer: {
          id: dispute.user.id,
          name: [dispute.user.firstName, dispute.user.lastName].filter(Boolean).join(" "),
          email: dispute.user.email,
        },
      }
    : {}),
  ...(dispute.events ? { events: dispute.events.map(formatEvent) } : {}),
});

const transactionSelect = {
  id: true,
  reference: true,
  type: true,
  status: true,
  amount: true,
  currency: true,
  createdAt: true,
  sourceWallet: { select: { userId: true } },
  destinationWallet: { select: { userId: true } },
};

const createDispute = async ({ userId, transactionReference, reason, description }) => {
  if (!REASONS.has(reason)) {
    throw ApiError.validation({ reason: "Unsupported dispute reason" });
  }

  const transaction = await prisma.transaction.findUnique({
    where: { reference: transactionReference },
    select: transactionSelect,
  });
  if (
    !transaction ||
    (transaction.sourceWallet?.userId !== userId &&
      transaction.destinationWallet?.userId !== userId)
  ) {
    throw ApiError.notFound("Transaction not found", "TRANSACTION_NOT_FOUND");
  }

  const existing = await prisma.dispute.findFirst({
    where: {
      userId,
      transactionId: transaction.id,
      status: { in: OPEN_STATUSES },
    },
    select: { reference: true },
  });
  if (existing) {
    throw ApiError.conflict(
      "An open dispute already exists for this transaction",
      "DISPUTE_ALREADY_OPEN",
      { reference: existing.reference }
    );
  }

  const user = await prisma.userProfile.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  const dispute = await prisma.$transaction(async (tx) => {
    const created = await tx.dispute.create({
      data: {
        userId,
        transactionId: transaction.id,
        reason,
        description,
        status: "OPEN",
        events: {
          create: {
            type: "OPENED",
            note: "Dispute submitted by customer",
            actorUserId: userId,
          },
        },
      },
      include: { transaction: { select: transactionSelect }, events: true },
    });

    await outbox.enqueue(tx, {
      type: "dispute.opened",
      aggregateType: "Dispute",
      aggregateId: created.id,
      payload: {
        disputeReference: created.reference,
        userId,
        email: user?.email || null,
        transactionReference: transaction.reference,
        amount: transaction.amount.toFixed(2),
        currency: transaction.currency,
        reason,
      },
    });

    return created;
  });

  audit("DISPUTE_OPENED", {
    userId,
    disputeReference: dispute.reference,
    transactionReference: transaction.reference,
    reason,
  });
  return { dispute: formatDispute(dispute) };
};

const listUserDisputes = async (userId, { status, limit = 25, cursor } = {}) => {
  if (status && !STATUSES.has(status)) {
    throw ApiError.validation({ status: "Unsupported dispute status" });
  }
  if (cursor) {
    const existing = await prisma.dispute.findFirst({
      where: { id: cursor, userId },
      select: { id: true },
    });
    if (!existing) {
      throw ApiError.badRequest("Dispute cursor is invalid", "INVALID_DISPUTE_CURSOR");
    }
  }

  const disputes = await prisma.dispute.findMany({
    where: { userId, ...(status ? { status } : {}) },
    orderBy: [{ openedAt: "desc" }, { id: "desc" }],
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: limit + 1,
    include: { transaction: { select: transactionSelect } },
  });
  const hasMore = disputes.length > limit;
  const page = disputes.slice(0, limit);
  return {
    disputes: page.map(formatDispute),
    page: { limit, hasMore, nextCursor: hasMore ? page[page.length - 1].id : null },
  };
};

const getUserDispute = async (userId, reference) => {
  const dispute = await prisma.dispute.findFirst({
    where: { reference, userId },
    include: {
      transaction: { select: transactionSelect },
      events: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!dispute) {
    throw ApiError.notFound("Dispute not found", "DISPUTE_NOT_FOUND");
  }
  return { dispute: formatDispute(dispute) };
};

const listAllDisputes = async ({ status, q, limit = 25, cursor } = {}) => {
  if (status && !STATUSES.has(status)) {
    throw ApiError.validation({ status: "Unsupported dispute status" });
  }
  if (cursor) {
    const existing = await prisma.dispute.findUnique({
      where: { id: cursor },
      select: { id: true },
    });
    if (!existing) {
      throw ApiError.badRequest("Dispute cursor is invalid", "INVALID_DISPUTE_CURSOR");
    }
  }

  const where = {
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { reference: { contains: q, mode: "insensitive" } },
            { transaction: { reference: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const disputes = await prisma.dispute.findMany({
    where,
    orderBy: [{ openedAt: "desc" }, { id: "desc" }],
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: limit + 1,
    include: {
      transaction: { select: transactionSelect },
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });
  const hasMore = disputes.length > limit;
  const page = disputes.slice(0, limit);
  return {
    disputes: page.map(formatDispute),
    page: { limit, hasMore, nextCursor: hasMore ? page[page.length - 1].id : null },
  };
};

const getDisputeForStaff = async (reference) => {
  const dispute = await prisma.dispute.findUnique({
    where: { reference },
    include: {
      transaction: { select: transactionSelect },
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
      events: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!dispute) {
    throw ApiError.notFound("Dispute not found", "DISPUTE_NOT_FOUND");
  }
  return { dispute: formatDispute(dispute) };
};

const updateDispute = async ({
  reference,
  status,
  resolution,
  assignedTo,
  resolvedAmount,
  actorId,
}) => {
  if (!STATUSES.has(status)) {
    throw ApiError.validation({ status: "Unsupported dispute status" });
  }
  if ((status === "RESOLVED" || status === "REJECTED") && !String(resolution || "").trim()) {
    throw ApiError.validation({
      resolution: "A resolution note is required to close a dispute",
    });
  }

  let resolvedAmountString = null;
  if (resolvedAmount !== undefined && resolvedAmount !== null) {
    resolvedAmountString = toAmountString(resolvedAmount);
  }

  const dispute = await prisma.dispute.findUnique({
    where: { reference },
    include: { user: { select: { email: true } } },
  });
  if (!dispute) {
    throw ApiError.notFound("Dispute not found", "DISPUTE_NOT_FOUND");
  }

  const allowed = TRANSITIONS[dispute.status] || [];
  if (!allowed.includes(status)) {
    throw ApiError.conflict(
      `Cannot change dispute status from ${dispute.status} to ${status}`,
      "INVALID_DISPUTE_TRANSITION"
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.dispute.update({
      where: { id: dispute.id },
      data: {
        status,
        ...(resolution !== undefined ? { resolution: resolution || null } : {}),
        ...(assignedTo !== undefined ? { assignedTo: assignedTo || null } : {}),
        ...(resolvedAmountString
          ? { resolvedAmount: new Prisma.Decimal(resolvedAmountString) }
          : {}),
        events: {
          create: {
            type: `STATUS_${status}`,
            note: resolution || null,
            actorUserId: actorId || null,
          },
        },
      },
      include: {
        transaction: { select: transactionSelect },
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        events: { orderBy: { createdAt: "asc" } },
      },
    });

    await outbox.enqueue(tx, {
      type: "dispute.updated",
      aggregateType: "Dispute",
      aggregateId: row.id,
      payload: {
        disputeReference: row.reference,
        userId: row.userId,
        email: row.user?.email || null,
        status: row.status,
        resolution: row.resolution,
        transactionReference: row.transaction.reference,
      },
    });

    return row;
  });

  audit("DISPUTE_STATUS_CHANGED", {
    disputeReference: reference,
    from: dispute.status,
    to: status,
    actorId: actorId || null,
  });
  return { dispute: formatDispute(updated) };
};

module.exports = {
  REASONS,
  STATUSES,
  TRANSITIONS,
  createDispute,
  listUserDisputes,
  getUserDispute,
  listAllDisputes,
  getDisputeForStaff,
  updateDispute,
};
