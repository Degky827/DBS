const env = require("../config/env");
const ApiError = require("../utils/ApiError");
const logger = require("../config/logger");

const TIMEOUT_MS = 5 * 1000;
const CONTACT_TIMEOUT_MS = 3 * 1000;

async function getMyProfile(authorization) {
  let response;
  try {
    response = await fetch(`${env.USER_SERVICE_URL}/users/me`, {
      headers: { Authorization: authorization },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    logger.warn(
      { error: error.name === "TimeoutError" ? "timeout" : "unreachable" },
      "user-service unavailable during KYC submission"
    );
    throw ApiError.serviceUnavailable(
      "Unable to retrieve your registered profile right now",
      "USER_SERVICE_UNAVAILABLE"
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw ApiError.unauthorized(
      "Authentication with the registered profile service failed",
      "UPSTREAM_AUTHENTICATION_FAILED"
    );
  }
  if (response.status === 404) {
    throw ApiError.notFound("Registered profile not found", "USER_PROFILE_NOT_FOUND");
  }
  if (!response.ok) {
    logger.warn({ statusCode: response.status }, "user-service rejected KYC profile lookup");
    throw ApiError.serviceUnavailable(
      "Unable to retrieve your registered profile right now",
      "USER_SERVICE_UNAVAILABLE"
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw ApiError.badGateway("User service returned an invalid profile response");
  }

  const profile = payload?.data?.user;
  if (!profile || typeof profile.id !== "string") {
    throw ApiError.badGateway("User service returned an invalid profile response");
  }

  return profile;
}

// Server-to-server lookup used by the re-verification sweep, where no customer
// access token exists. user-service returns contact fields only; kyc-service
// keeps no copy of them, so a changed address takes effect on the next reminder.
async function getContact(userId) {
  const url = `${env.USER_SERVICE_URL}/internal/users/${encodeURIComponent(userId)}/contact`;
  let response;
  try {
    response = await fetch(url, {
      headers: { "X-Internal-Service-Key": env.INTERNAL_SERVICE_KEY || "" },
      signal: AbortSignal.timeout(CONTACT_TIMEOUT_MS),
    });
  } catch (error) {
    logger.warn(
      { error: error.name === "TimeoutError" ? "timeout" : "unreachable" },
      "user-service unavailable during KYC contact lookup"
    );
    throw ApiError.serviceUnavailable(
      "Unable to look up the customer contact",
      "USER_SERVICE_UNAVAILABLE"
    );
  }

  if (response.status === 404) {
    throw ApiError.notFound("Customer contact not found", "USER_PROFILE_NOT_FOUND");
  }
  if (!response.ok) {
    throw ApiError.serviceUnavailable(
      "Unable to look up the customer contact",
      "USER_SERVICE_UNAVAILABLE"
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw ApiError.badGateway("User service returned an invalid contact response");
  }

  const contact = payload?.data?.contact;
  if (!contact || typeof contact.userId !== "string" || typeof contact.email !== "string") {
    throw ApiError.badGateway("User service returned an invalid contact response");
  }
  return contact;
}

module.exports = { getMyProfile, getContact };
