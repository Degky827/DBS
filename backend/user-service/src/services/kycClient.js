const env = require("../config/env");
const logger = require("../config/logger");

const TIMEOUT_MS = 5 * 1000;

class KycUnavailableError extends Error {
  constructor(message = "KYC status is unavailable") {
    super(message);
    this.name = "KycUnavailableError";
  }
}

// Reads the authoritative KYC status from kyc-service. Any transport,
// configuration, or payload problem is surfaced as KycUnavailableError so
// callers can fail closed rather than assuming an approval.
const getUserKycStatus = async (userId) => {
  if (!env.KYC_SERVICE_URL) {
    throw new KycUnavailableError("KYC_SERVICE_URL is not configured");
  }

  const url = `${env.KYC_SERVICE_URL}/internal/users/${encodeURIComponent(
    userId
  )}/status`;

  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Internal-Service-Key": env.INTERNAL_SERVICE_KEY || "",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    logger.warn(
      { error: error.message },
      "kyc-service unreachable during eligibility check"
    );
    throw new KycUnavailableError("KYC service is unreachable");
  }

  if (!response.ok) {
    logger.warn(
      { status: response.status },
      "kyc-service returned an error during eligibility check"
    );
    throw new KycUnavailableError("KYC service returned an error");
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new KycUnavailableError("KYC service returned an invalid response");
  }

  const data = payload?.data;
  if (!data || typeof data.isApproved !== "boolean") {
    throw new KycUnavailableError("KYC service returned an invalid status");
  }

  return {
    status: typeof data.status === "string" ? data.status : "UNKNOWN",
    isApproved: data.isApproved,
  };
};

module.exports = { getUserKycStatus, KycUnavailableError };
