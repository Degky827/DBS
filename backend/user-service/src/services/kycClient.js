const env = require("../config/env");
const logger = require("../config/logger");
const cache = require("./cache");

const TIMEOUT_MS = 5 * 1000;

const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d{0,16})(?:\.\d{1,2})?$/;

class KycUnavailableError extends Error {
  constructor(message = "KYC status is unavailable") {
    super(message);
    this.name = "KycUnavailableError";
  }
}

const decimalField = (value, field, operation) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!DECIMAL_PATTERN.test(text)) {
    throw new KycUnavailableError(
      `KYC service returned an invalid tier limit (${operation}.${field})`
    );
  }
  return text;
};

const countField = (value, field, operation) => {
  if (value === null || value === undefined) return null;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0) {
    throw new KycUnavailableError(
      `KYC service returned an invalid tier limit (${operation}.${field})`
    );
  }
  return count;
};

const parseLimit = (row) => {
  if (!row || typeof row !== "object") {
    throw new KycUnavailableError("KYC service returned an invalid tier limit");
  }
  const operation = typeof row.operation === "string" ? row.operation : "";
  const currency =
    typeof row.currency === "string" && /^[A-Z]{3}$/.test(row.currency) ? row.currency : null;
  if (!operation || !currency) {
    throw new KycUnavailableError("KYC service returned an invalid tier limit");
  }
  return {
    operation,
    currency,
    minAmount: decimalField(row.minAmount, "minAmount", operation),
    maxAmount: decimalField(row.maxAmount, "maxAmount", operation),
    dailyAmount: decimalField(row.dailyAmount, "dailyAmount", operation),
    dailyCount: countField(row.dailyCount, "dailyCount", operation),
    monthlyAmount: decimalField(row.monthlyAmount, "monthlyAmount", operation),
    maxBalance: decimalField(row.maxBalance, "maxBalance", operation),
    isAllowed: row.isAllowed !== false,
  };
};

// The tier payload is additive: kyc-service has returned it since Phase 4, and
// a response without one is read as "no tier policy", which leaves the
// platform's own financial policy in charge. A present-but-malformed payload
// throws instead, so a truncated limit list can never widen what a customer
// may move.
const parseTier = (data) => {
  const code = typeof data.tierCode === "string" ? data.tierCode : null;
  const rawLimits = data.limits === undefined ? null : data.limits;
  if (rawLimits !== null && !Array.isArray(rawLimits)) {
    throw new KycUnavailableError("KYC service returned an invalid tier payload");
  }
  if (code === null || data.tierSource === "NOT_CONFIGURED") {
    // Limits without a tier to attach them to are a broken contract, not an
    // absent one.
    if (rawLimits && rawLimits.length > 0) {
      throw new KycUnavailableError("KYC service returned limits without a tier");
    }
    return null;
  }
  return {
    id: typeof data.tierId === "string" ? data.tierId : null,
    code,
    version: Number.isInteger(data.tierVersion) ? data.tierVersion : null,
    source: typeof data.tierSource === "string" ? data.tierSource : null,
    allowedOperations: Array.isArray(data.allowedOperations)
      ? data.allowedOperations.filter((name) => typeof name === "string")
      : [],
    limits: (rawLimits || []).map(parseLimit),
  };
};

// Reads the authoritative KYC status from kyc-service. Any transport,
// configuration, or payload problem is surfaced as KycUnavailableError so
// callers can fail closed rather than assuming an approval.
const getUserKycStatus = async (userId) => {
  if (!env.KYC_SERVICE_URL) {
    throw new KycUnavailableError("KYC_SERVICE_URL is not configured");
  }

  const cacheKey = `kyc-status:${userId}`;
  const cached = await cache.getJson(cacheKey);
  if (cached) return cached;

  const url = `${env.KYC_SERVICE_URL}/internal/users/${encodeURIComponent(userId)}/status`;

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
    logger.warn({ error: error.message }, "kyc-service unreachable during eligibility check");
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

  const result = {
    status: typeof data.status === "string" ? data.status : "UNKNOWN",
    isApproved: data.isApproved,
    tier: parseTier(data),
  };
  await cache.setJson(cacheKey, result, cacheTtlSeconds(data));
  return result;
};

// A cached approval never outlives the expiry kyc-service just reported, and a
// tier an officer can change is only reused for a short, configurable window.
// Zero or less means the value is freshest-read only, which is what an
// already-expired or imminently-expiring approval needs.
const cacheTtlSeconds = (data) => {
  const expiresAt = Date.parse(data.approvalExpiresAt ?? "");
  if (!Number.isFinite(expiresAt)) return env.KYC_STATUS_CACHE_TTL_SECONDS;
  return Math.min(env.KYC_STATUS_CACHE_TTL_SECONDS, Math.floor((expiresAt - Date.now()) / 1000));
};

module.exports = { getUserKycStatus, KycUnavailableError };
