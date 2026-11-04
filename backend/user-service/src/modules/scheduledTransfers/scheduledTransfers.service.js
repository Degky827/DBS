const { Prisma } = require("@prisma/client");
const prisma = require("../../config/database");
const env = require("../../config/env");
const ApiError = require("../../utils/ApiError");
const audit = require("../../utils/audit");
const walletsService = require("../wallets/wallets.service");
const tierLimits = require("../policies/tierLimits.service");
const outbox = require("../outbox/outbox.service");
const { toAmountString, toMinorUnits } = require("../wallets/money");

const FREQUENCIES = new Set(["ONCE", "DAILY", "WEEKLY", "MONTHLY"]);
const STATUSES = new Set(["ACTIVE", "PAUSED", "COMPLETED", "CANCELLED", "FAILED"]);

const formatSchedule = (schedule) => ({
  id: schedule.id,
  destinationWalletId: schedule.destinationWalletId,
  amount: schedule.amount.toFixed(2),
  currency: schedule.currency,
  frequency: schedule.frequency,
  nextRunAt: schedule.nextRunAt,
  timezone: schedule.timezone,
  status: schedule.status,
  lastRunAt: schedule.lastRunAt,
  lastTransactionId: schedule.lastTransactionId,
  failureReason: schedule.failureReason,
  createdAt: schedule.createdAt,
  updatedAt: schedule.updatedAt,
});

const addMonthsClamped = (date, months) => {
  const target = new Date(date);
  const day = target.getUTCDate();
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const daysInTargetMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  target.setUTCDate(Math.min(day, daysInTargetMonth));
  return target;
};

const nextRunAfter = (date, frequency) => {
  if (frequency === "ONCE") return null;
  if (frequency === "DAILY") return new Date(date.getTime() + 24 * 60 * 60 * 1000);
  if (frequency === "WEEKLY") return new Date(date.getTime() + 7 * 24 * 60 * 60 * 1000);
  return addMonthsClamped(date, 1);
};

const createSchedule = async ({
  userId,
  destinationWalletId,
  amount,
  frequency,
  firstRunAt,
  timezone,
  kyc,
}) => {
  if (!FREQUENCIES.has(frequency)) {
    throw ApiError.validation({ frequency: "Unsupported schedule frequency" });
  }
  const amountString = toAmountString(amount);
  const runAt = new Date(firstRunAt);
  if (Number.isNaN(runAt.getTime())) {
    throw ApiError.validation({ firstRunAt: "firstRunAt must be a valid ISO timestamp" });
  }
  if (runAt.getTime() <= Date.now()) {
    throw ApiError.validation({ firstRunAt: "firstRunAt must be in the future" });
  }

  const [sourceWallet, destinationWallet] = await Promise.all([
    prisma.wallet.findUnique({
      where: { userId },
      select: { id: true, currency: true, isActive: true },
    }),
    prisma.wallet.findUnique({
      where: { id: destinationWalletId },
      select: { id: true, currency: true, isActive: true },
    }),
  ]);

  if (!sourceWallet) {
    throw ApiError.notFound("Wallet not found", "WALLET_NOT_FOUND");
  }
  if (!sourceWallet.isActive) {
    throw ApiError.conflict("Wallet is inactive", "WALLET_INACTIVE");
  }
  if (!destinationWallet) {
    throw ApiError.notFound("Destination wallet not found", "WALLET_NOT_FOUND");
  }
  if (destinationWallet.id === sourceWallet.id) {
    throw ApiError.badRequest("A wallet cannot schedule transfers to itself", "SELF_TRANSFER");
  }
  if (destinationWallet.currency !== sourceWallet.currency) {
    throw ApiError.badRequest(
      "Scheduled transfers must use the wallet currency",
      "CURRENCY_MISMATCH"
    );
  }

  // Every run is a transfer, so both operations have to be authorized, and the
  // whole recurrence has to fit the tier's ceilings: the worker that executes
  // due schedules has no KYC session to re-check them against.
  tierLimits.limitFor(kyc, "TRANSFER", sourceWallet.currency);
  const tierDecision = tierLimits.assertScheduleWithinTierLimits({
    kyc,
    currency: sourceWallet.currency,
    frequency,
    amountCents: toMinorUnits(amountString),
  });

  const schedule = await prisma.scheduledTransfer.create({
    data: {
      userId,
      destinationWalletId,
      amount: new Prisma.Decimal(amountString),
      currency: sourceWallet.currency,
      frequency,
      nextRunAt: runAt,
      timezone: timezone || "Africa/Addis_Ababa",
    },
  });

  audit("SCHEDULED_TRANSFER_CREATED", {
    userId,
    scheduleId: schedule.id,
    frequency,
    nextRunAt: runAt.toISOString(),
    amount: amountString,
    kycTier: tierLimits.tierSnapshot(tierDecision, kyc),
  });
  return { schedule: formatSchedule(schedule) };
};

const listSchedules = async (userId, { status, limit = 25, cursor } = {}) => {
  if (status && !STATUSES.has(status)) {
    throw ApiError.validation({ status: "Unsupported schedule status" });
  }
  if (cursor) {
    const existing = await prisma.scheduledTransfer.findFirst({
      where: { id: cursor, userId },
      select: { id: true },
    });
    if (!existing) {
      throw ApiError.badRequest("Schedule cursor is invalid", "INVALID_SCHEDULE_CURSOR");
    }
  }

  const schedules = await prisma.scheduledTransfer.findMany({
    where: { userId, ...(status ? { status } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: limit + 1,
  });
  const hasMore = schedules.length > limit;
  const page = schedules.slice(0, limit);

  return {
    schedules: page.map(formatSchedule),
    page: {
      limit,
      hasMore,
      nextCursor: hasMore ? page[page.length - 1].id : null,
    },
  };
};

const getSchedule = async (userId, scheduleId) => {
  const schedule = await prisma.scheduledTransfer.findFirst({
    where: { id: scheduleId, userId },
  });
  if (!schedule) {
    throw ApiError.notFound("Scheduled transfer not found", "SCHEDULE_NOT_FOUND");
  }
  return { schedule: formatSchedule(schedule) };
};

const transition = async ({ userId, scheduleId, action, actorId, kyc }) => {
  const schedule = await prisma.scheduledTransfer.findFirst({
    where: { id: scheduleId, userId },
  });
  if (!schedule) {
    throw ApiError.notFound("Scheduled transfer not found", "SCHEDULE_NOT_FOUND");
  }

  const transitions = {
    pause: { from: ["ACTIVE"], to: "PAUSED" },
    resume: { from: ["PAUSED"], to: "ACTIVE" },
    cancel: { from: ["ACTIVE", "PAUSED", "FAILED"], to: "CANCELLED" },
  };
  const rule = transitions[action];
  if (!rule || !rule.from.includes(schedule.status)) {
    throw ApiError.conflict(
      `Cannot ${action} a ${schedule.status.toLowerCase()} schedule`,
      "INVALID_SCHEDULE_TRANSITION"
    );
  }

  if (action === "resume") {
    // Resuming puts the money in motion again, so the tier that is in force now
    // has to authorize the remaining recurrence. Pausing and cancelling are
    // never gated: a restricted customer must always be able to stop a schedule.
    tierLimits.limitFor(kyc, "TRANSFER", schedule.currency);
    tierLimits.assertScheduleWithinTierLimits({
      kyc,
      currency: schedule.currency,
      frequency: schedule.frequency,
      amountCents: toMinorUnits(schedule.amount.toFixed(2)),
    });
  }

  const updated = await prisma.scheduledTransfer.update({
    where: { id: schedule.id },
    data: {
      status: rule.to,
      ...(action === "resume"
        ? { nextRunAt: new Date(Date.now() + 60 * 1000), failureReason: null }
        : {}),
    },
  });

  audit(`SCHEDULED_TRANSFER_${rule.to}`, {
    userId,
    scheduleId: schedule.id,
    actorId: actorId || userId,
    previousStatus: schedule.status,
  });
  return { schedule: formatSchedule(updated) };
};

const runSchedule = async (schedule) => {
  const runAt = schedule.nextRunAt;
  const idempotencyKey = `sched:${schedule.id}:${runAt.toISOString()}`;
  // No KYC tier context travels here: the worker has no session, and the
  // profile id it holds is not the identifier kyc-service keys approvals by.
  // The run records the clamp as skipped; the ceilings were applied to the
  // whole recurrence when the schedule was created or resumed.
  return walletsService.transfer({
    userId: schedule.userId,
    destinationWalletId: schedule.destinationWalletId,
    amount: schedule.amount.toFixed(2),
    idempotencyKey,
  });
};

const completeRun = async (schedule, transaction) => {
  const nextRunAt =
    schedule.frequency === "ONCE" ? null : nextRunAfter(schedule.nextRunAt, schedule.frequency);

  await prisma.$transaction(async (tx) => {
    await tx.scheduledTransfer.update({
      where: { id: schedule.id },
      data: {
        status: nextRunAt ? "ACTIVE" : "COMPLETED",
        lastRunAt: schedule.nextRunAt,
        lastTransactionId: transaction.id,
        failureReason: null,
        ...(nextRunAt ? { nextRunAt } : {}),
      },
    });
  });

  audit("SCHEDULED_TRANSFER_EXECUTED", {
    userId: schedule.userId,
    scheduleId: schedule.id,
    transactionReference: transaction.reference,
    amount: transaction.amount,
  });
};

const failRun = async (schedule, error) => {
  const reason = String(error.message || error).slice(0, 300);
  const user = await prisma.userProfile.findUnique({
    where: { id: schedule.userId },
    select: { email: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.scheduledTransfer.update({
      where: { id: schedule.id },
      data: { status: "PAUSED", failureReason: reason },
    });
    await outbox.enqueue(tx, {
      type: "scheduled_transfer.failed",
      aggregateType: "ScheduledTransfer",
      aggregateId: schedule.id,
      payload: {
        scheduleId: schedule.id,
        userId: schedule.userId,
        email: user?.email || null,
        amount: schedule.amount.toFixed(2),
        currency: schedule.currency,
        reason,
      },
    });
  });

  audit("SCHEDULED_TRANSFER_FAILED", {
    userId: schedule.userId,
    scheduleId: schedule.id,
    reason,
  });
};

// At-least-once execution is made idempotent by the transfer key derived from
// the schedule id and its planned run time; a retry cannot debit twice.
const executeDueSchedules = async ({ now = new Date(), batchSize } = {}) => {
  const due = await prisma.scheduledTransfer.findMany({
    where: { status: "ACTIVE", nextRunAt: { lte: now } },
    orderBy: { nextRunAt: "asc" },
    take: batchSize || env.SCHEDULED_TRANSFERS_BATCH_SIZE,
  });

  for (const schedule of due) {
    try {
      const result = await runSchedule(schedule);
      await completeRun(schedule, result.transaction);
    } catch (error) {
      await failRun(schedule, error);
    }
  }

  return { processed: due.length };
};

module.exports = {
  FREQUENCIES,
  STATUSES,
  createSchedule,
  listSchedules,
  getSchedule,
  pauseSchedule: (args) => transition({ ...args, action: "pause" }),
  resumeSchedule: (args) => transition({ ...args, action: "resume" }),
  cancelSchedule: (args) => transition({ ...args, action: "cancel" }),
  executeDueSchedules,
  nextRunAfter,
};
