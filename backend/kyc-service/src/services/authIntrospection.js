const env = require("../config/env");
const ApiError = require("../utils/ApiError");
const logger = require("../config/logger");

const TIMEOUT_MS = 3 * 1000;

// Local signature verification cannot observe a logout or password change.
// Tokens minted by auth-service carry a sid, so they are checked against the
// issuer. Stateless test/legacy tokens without sid skip the round trip.
const assertTokenActive = async (token, payload) => {
  if (!payload.sid) return null;

  if (!env.AUTH_SERVICE_URL) {
    if (env.IS_PRODUCTION) {
      throw ApiError.serviceUnavailable(
        "Authentication service is not configured",
        "AUTH_SERVICE_UNAVAILABLE"
      );
    }
    return null;
  }

  let response;
  try {
    response = await fetch(`${env.AUTH_SERVICE_URL}/internal/tokens/introspect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Service-Key": env.INTERNAL_SERVICE_KEY || "",
      },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    logger.warn(
      { error: error.message },
      "auth-service unreachable during token introspection"
    );
    throw ApiError.serviceUnavailable(
      "Authentication status is temporarily unavailable",
      "AUTH_SERVICE_UNAVAILABLE"
    );
  }

  if (response.status === 401) {
    throw ApiError.serviceUnavailable(
      "Authentication service rejected the introspection request",
      "AUTH_SERVICE_UNAVAILABLE"
    );
  }

  const body = await response.json().catch(() => null);

  if (!response.ok || !body?.data) {
    throw ApiError.serviceUnavailable(
      "Authentication status is temporarily unavailable",
      "AUTH_SERVICE_UNAVAILABLE"
    );
  }

  if (body.data.active !== true) {
    throw ApiError.unauthorized(
      "Access token is no longer active",
      body.data.reason || "TOKEN_REVOKED"
    );
  }

  return body.data;
};

module.exports = { assertTokenActive };
