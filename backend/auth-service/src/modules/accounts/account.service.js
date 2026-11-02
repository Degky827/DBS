const userRepository = require("../../repositories/user.repository");
const refreshTokenRepository = require("../../repositories/refreshToken.repository");
const ApiError = require("../../utils/ApiError");
const audit = require("../../utils/audit");
const { ACCOUNT_STATUSES } = require("../../utils/accountStatus");
const { comparePassword } = require("../../utils/password.util");

// CLOSED is terminal so an account cannot be reopened after its data was
// handed off to retention, and every FROZEN/SUSPENDED/CLOSED transition
// requires an operator-visible reason.
const TRANSITIONS = Object.freeze({
  ACTIVE: Object.freeze(["FROZEN", "SUSPENDED", "CLOSED"]),
  FROZEN: Object.freeze(["ACTIVE", "SUSPENDED", "CLOSED"]),
  SUSPENDED: Object.freeze(["ACTIVE", "FROZEN", "CLOSED"]),
  CLOSED: Object.freeze([]),
});

const REASON_REQUIRED = new Set(["FROZEN", "SUSPENDED", "CLOSED"]);

const toStatusPayload = (user) => ({
  userId: user.id,
  email: user.email,
  status: user.status || "ACTIVE",
  statusReason: user.statusReason || null,
  statusChangedAt: user.statusChangedAt || null,
  statusChangedBy: user.statusChangedBy || null,
  closedAt: user.closedAt || null,
  mfaEnabled: user.mfaEnabled === true,
});

const applyStatus = async ({ user, status, reason, actorId }) => {
  const currentStatus = user.status || "ACTIVE";
  if (currentStatus === status) {
    return toStatusPayload(user);
  }

  const allowed = TRANSITIONS[currentStatus] || [];
  if (!allowed.includes(status)) {
    throw ApiError.conflict(
      `Cannot change account status from ${currentStatus} to ${status}`,
      "INVALID_STATUS_TRANSITION"
    );
  }

  const trimmedReason = typeof reason === "string" ? reason.trim() : "";
  if (REASON_REQUIRED.has(status) && trimmedReason.length < 3) {
    throw ApiError.validation([
      {
        path: ["reason"],
        message: "A reason of at least 3 characters is required",
      },
    ]);
  }

  const now = new Date();
  const updated = await userRepository.update(user.id, {
    status,
    statusReason: status === "ACTIVE" ? null : trimmedReason,
    statusChangedAt: now,
    statusChangedBy: actorId || null,
    closedAt: status === "CLOSED" ? now : user.closedAt || null,
  });

  // Every status change takes effect immediately: existing access tokens are
  // rejected through tokenValidAfter and refresh families are revoked.
  await userRepository.invalidateSessions(user.id, now);
  await refreshTokenRepository.revokeAllForUser(user.id);

  audit("ACCOUNT_STATUS_CHANGED", {
    userId: user.id,
    from: currentStatus,
    to: status,
    reason: trimmedReason || null,
    actorId: actorId || null,
  });

  return toStatusPayload(updated);
};

const setStatus = async ({ email, status, reason, actorId }) => {
  if (!ACCOUNT_STATUSES.includes(status)) {
    throw ApiError.badRequest("Unsupported account status");
  }

  const user = await userRepository.findByEmail(
    String(email || "").trim().toLowerCase()
  );
  if (!user) {
    throw ApiError.notFound("Account not found", "USER_NOT_FOUND");
  }

  return applyStatus({ user, status, reason, actorId });
};

const closeOwnAccount = async ({ email, password, reason }) => {
  const user = await userRepository.findByEmail(
    String(email || "").trim().toLowerCase()
  );
  if (!user) {
    throw ApiError.notFound("Account not found", "USER_NOT_FOUND");
  }
  if (user.status === "CLOSED") {
    throw ApiError.conflict("Account is already closed", "ACCOUNT_CLOSED");
  }

  const valid = await comparePassword(password, user.passwordHash || "");
  if (!valid) {
    audit("ACCOUNT_CLOSE_FAILED", { userId: user.id, reason: "PASSWORD" });
    throw ApiError.unauthorized(
      "Password is incorrect",
      "INVALID_CURRENT_PASSWORD"
    );
  }

  return applyStatus({
    user,
    status: "CLOSED",
    reason: reason || "Closed by account holder",
    actorId: user.id,
  });
};

const bulkStatuses = async (emails) => {
  const normalized = emails.map((email) => String(email).trim().toLowerCase());
  const rows = await userRepository.findManyByEmails(normalized);
  const byEmail = new Map(rows.map((row) => [row.email, row]));

  return normalized.map((email) => {
    const row = byEmail.get(email);
    return {
      email,
      userId: row?.id || null,
      status: row?.status || "ACTIVE",
      statusReason: row?.statusReason || null,
      statusChangedAt: row?.statusChangedAt || null,
      mfaEnabled: row?.mfaEnabled === true,
    };
  });
};

module.exports = { setStatus, closeOwnAccount, bulkStatuses, toStatusPayload };
