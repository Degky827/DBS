const env = require("../config/env");
const ApiError = require("../utils/ApiError");
const logger = require("../config/logger");

const TIMEOUT_MS = 10 * 1000;

// Calls auth-service's internal change-password endpoint so the real
// credential (Phase 1 source of truth) is updated when AUTH_MODE=jwt.
const changeAuthPassword = async ({ email, currentPassword, newPassword }) => {
  if (!env.AUTH_SERVICE_URL) {
    throw ApiError.internal(
      "AUTH_SERVICE_URL is not configured for password changes"
    );
  }

  const url = `${env.AUTH_SERVICE_URL}/internal/users/change-password`;

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Service-Key": env.INTERNAL_SERVICE_KEY || "",
      },
      body: JSON.stringify({ email, currentPassword, newPassword }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    logger.warn(
      { error: error.message },
      "auth-service unreachable during password change"
    );
    throw ApiError.internal(
      "Unable to change password right now. Please try again."
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (response.ok) {
    return { message: payload?.message || "Password has been changed" };
  }

  const message = payload?.message || "Unable to change password";

  if (response.status === 400) {
    const errors =
      payload?.errors &&
      typeof payload.errors === "object" &&
      !Array.isArray(payload.errors)
        ? payload.errors
        : null;
    const validationMessage =
      errors &&
      Object.values(errors).find((value) => typeof value === "string");
    throw ApiError.badRequest(
      validationMessage || message,
      payload?.code || "BAD_REQUEST",
      errors
    );
  }
  if (response.status === 401) {
    throw ApiError.unauthorized(
      message,
      payload?.code || "INVALID_CURRENT_PASSWORD"
    );
  }
  if (response.status === 404) {
    throw ApiError.notFound(message, payload?.code || "USER_NOT_FOUND");
  }

  throw ApiError.internal("Unable to change password right now. Please try again.");
};

const callInternal = async (path, body) => {
  if (!env.AUTH_SERVICE_URL) {
    throw ApiError.internal("AUTH_SERVICE_URL is not configured");
  }

  let response;
  try {
    response = await fetch(`${env.AUTH_SERVICE_URL}/internal${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Service-Key": env.INTERNAL_SERVICE_KEY || "",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    logger.warn(
      { error: error.message, path },
      "auth-service unreachable during internal call"
    );
    throw ApiError.serviceUnavailable(
      "Authentication service is temporarily unavailable",
      "AUTH_SERVICE_UNAVAILABLE"
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message = payload?.message || "Authentication request failed";
    if (response.status === 400) {
      throw ApiError.badRequest(message, payload?.code || "BAD_REQUEST");
    }
    if (response.status === 401) {
      throw ApiError.unauthorized(message, payload?.code || "UNAUTHORIZED");
    }
    if (response.status === 403) {
      throw ApiError.forbidden(message, payload?.code || "FORBIDDEN");
    }
    if (response.status === 404) {
      throw ApiError.notFound(message, payload?.code || "USER_NOT_FOUND");
    }
    if (response.status === 409) {
      throw ApiError.conflict(message, payload?.code || "CONFLICT");
    }
    throw ApiError.serviceUnavailable(
      message,
      payload?.code || "AUTH_SERVICE_UNAVAILABLE"
    );
  }

  return payload?.data ?? null;
};

const setAccountStatus = ({ email, status, reason, actorId }) =>
  callInternal("/users/status", { email, status, reason, actorId });

const fetchAccountStatuses = async (emails) => {
  const data = await callInternal("/users/statuses", { emails });
  return data?.users || [];
};

const closeAccount = ({ email, password, reason }) =>
  callInternal("/users/close", { email, password, reason });

const resetMfa = ({ email, actorId }) =>
  callInternal("/users/mfa/reset", { email, actorId });

module.exports = {
  changeAuthPassword,
  setAccountStatus,
  fetchAccountStatuses,
  closeAccount,
  resetMfa,
};

