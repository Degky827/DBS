const prisma = require("../config/database");
const env = require("../config/env");
const logger = require("../config/logger");
const ApiError = require("../utils/ApiError");
const audit = require("../utils/audit");
const authClient = require("./authClient");
const devSessionRepository = require("../repositories/devSession.repository");

const ACCOUNT_STATUSES = Object.freeze([
  "ACTIVE",
  "FROZEN",
  "SUSPENDED",
  "CLOSED",
]);

// Mirrors auth-service so invalid transitions fail before the cross-service
// call; auth-service re-validates and remains the source of truth.
const STATUS_TRANSITIONS = Object.freeze({
  ACTIVE: Object.freeze(["FROZEN", "SUSPENDED", "CLOSED"]),
  FROZEN: Object.freeze(["ACTIVE", "SUSPENDED", "CLOSED"]),
  SUSPENDED: Object.freeze(["ACTIVE", "FROZEN", "CLOSED"]),
  CLOSED: Object.freeze([]),
});

const REASON_REQUIRED = new Set(["FROZEN", "SUSPENDED", "CLOSED"]);

const assertTransition = (current, next) => {
  if (!ACCOUNT_STATUSES.includes(next)) {
    throw ApiError.badRequest("Unsupported account status", "INVALID_STATUS");
  }
  if (current === next) return;
  const allowed = STATUS_TRANSITIONS[current] || [];
  if (!allowed.includes(next)) {
    throw ApiError.conflict(
      `Cannot change account status from ${current} to ${next}`,
      "INVALID_STATUS_TRANSITION"
    );
  }
};

const assertReason = (status, reason) => {
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  if (REASON_REQUIRED.has(status) && trimmed.length < 3) {
    throw ApiError.validation([
      {
        path: ["reason"],
        message: "A reason of at least 3 characters is required",
      },
    ]);
  }
  return trimmed;
};

const assertSettled = async (userId) => {
  const [wallet, pendingWithdrawals, pendingDeposits] = await Promise.all([
    prisma.wallet.findUnique({
      where: { userId },
      select: { id: true, balance: true },
    }),
    prisma.withdrawal.count({ where: { userId, status: "PENDING" } }),
    prisma.payment.count({ where: { userId, status: "PENDING" } }),
  ]);

  if (wallet && wallet.balance.gt(0)) {
    throw ApiError.conflict(
      "Withdraw or transfer the remaining balance before closing the account",
      "ACCOUNT_BALANCE_NOT_ZERO",
      { balance: wallet.balance.toFixed(2) }
    );
  }
  if (pendingWithdrawals > 0 || pendingDeposits > 0) {
    throw ApiError.conflict(
      "Resolve pending withdrawals and deposits before closing the account",
      "ACCOUNT_HAS_PENDING_ACTIVITY",
      { pendingWithdrawals, pendingDeposits }
    );
  }
};

const applyLocalStatus = async (userId, status) => {
  const updates = [
    prisma.userProfile.update({
      where: { id: userId },
      data: { accountStatus: status },
    }),
  ];

  if (status === "CLOSED") {
    updates.push(
      prisma.wallet.updateMany({
        where: { userId },
        data: { isActive: false },
      })
    );
  }

  await prisma.$transaction(updates);
  await devSessionRepository.revokeAllForUser(userId);
};

// Admin-driven status change. auth-service revokes access and refresh tokens;
// this service mirrors the state locally so financial guards stop immediately.
const changeStatus = async ({ userId, status, reason, actorId }) => {
  const user = await prisma.userProfile.findUnique({
    where: { id: userId },
    select: { id: true, email: true, accountStatus: true },
  });
  if (!user) {
    throw ApiError.notFound("User not found", "USER_NOT_FOUND");
  }

  const current = user.accountStatus || "ACTIVE";
  assertTransition(current, status);
  const trimmedReason = assertReason(status, reason);

  if (current === status) {
    return { userId: user.id, accountStatus: current };
  }

  if (status === "CLOSED") {
    await assertSettled(user.id);
  }

  if (env.AUTH_MODE === "jwt") {
    await authClient.setAccountStatus({
      email: user.email,
      status,
      reason: trimmedReason,
      actorId,
    });
  }

  await applyLocalStatus(user.id, status);

  audit("ACCOUNT_STATUS_CHANGED", {
    userId: user.id,
    from: current,
    to: status,
    reason: trimmedReason || null,
    actorId: actorId || null,
  });

  return { userId: user.id, accountStatus: status };
};

const resetMfa = async ({ userId, actorId }) => {
  const user = await prisma.userProfile.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });
  if (!user) {
    throw ApiError.notFound("User not found", "USER_NOT_FOUND");
  }

  if (env.AUTH_MODE === "jwt") {
    await authClient.resetMfa({ email: user.email, actorId });
  }

  audit("MFA_RESET_BY_ADMIN", { userId: user.id, actorId: actorId || null });
  return { userId: user.id, mfaEnabled: false };
};

// Best-effort overlay of auth-service state onto local rows so staff see the
// authoritative status without making the auth service a hard dependency of
// read-only admin screens.
const overlayAuthoritativeStatus = async (users) => {
  if (env.AUTH_MODE !== "jwt" || !env.AUTH_SERVICE_URL || users.length === 0) {
    return users;
  }

  try {
    const rows = await authClient.fetchAccountStatuses(
      users.map((user) => user.email)
    );
    const byEmail = new Map(rows.map((row) => [row.email, row]));
    return users.map((user) => {
      const row = byEmail.get(user.email);
      if (!row) return user;
      return {
        ...user,
        accountStatus: row.status,
        mfaEnabled: row.mfaEnabled === true,
      };
    });
  } catch (error) {
    logger.warn(
      { error: error.message },
      "Unable to refresh account statuses from auth-service"
    );
    return users;
  }
};

module.exports = {
  ACCOUNT_STATUSES,
  STATUS_TRANSITIONS,
  assertTransition,
  assertReason,
  assertSettled,
  applyLocalStatus,
  changeStatus,
  resetMfa,
  overlayAuthoritativeStatus,
};
