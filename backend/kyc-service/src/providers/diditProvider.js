const env = require("../config/env");
const ApiError = require("../utils/ApiError");
const logger = require("../config/logger");

const TIMEOUT_MS = 15 * 1000;

function requireConfiguration() {
  if (!env.DIDIT_API_KEY || !env.DIDIT_WORKFLOW_ID) {
    throw ApiError.serviceUnavailable(
      "Didit verification is not configured",
      "DIDIT_NOT_CONFIGURED"
    );
  }
}

async function requestDidit(path, options = {}) {
  requireConfiguration();
  let response;
  try {
    response = await fetch(`${env.DIDIT_API_BASE_URL}${path}`, {
      ...options,
      headers: {
        "x-api-key": env.DIDIT_API_KEY,
        Accept: "application/json",
        ...options.headers,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    logger.warn(
      { error: error.name === "TimeoutError" ? "timeout" : "unreachable" },
      "Didit API unavailable"
    );
    throw ApiError.serviceUnavailable(
      "Identity verification provider is temporarily unavailable",
      "DIDIT_UNAVAILABLE"
    );
  }

  if (!response.ok) {
    logger.warn(
      { statusCode: response.status },
      "Didit API rejected a KYC request"
    );
    if (response.status === 429 || response.status >= 500) {
      throw ApiError.serviceUnavailable(
        "Identity verification provider is temporarily unavailable",
        "DIDIT_UNAVAILABLE"
      );
    }
    throw ApiError.badGateway("Identity verification provider rejected the request");
  }

  try {
    return await response.json();
  } catch {
    throw ApiError.badGateway("Identity verification provider returned invalid data");
  }
}

async function createSession({ submissionId }) {
  const result = await requestDidit("/v3/session/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workflow_id: env.DIDIT_WORKFLOW_ID,
      vendor_data: submissionId,
      metadata: { submission_id: submissionId },
    }),
  });

  const sessionId = result?.session_id;
  const sessionUrl = result?.url || result?.session_url;
  if (
    typeof sessionId !== "string" ||
    typeof sessionUrl !== "string" ||
    !sessionUrl.startsWith("https://")
  ) {
    throw ApiError.badGateway(
      "Identity verification provider returned an invalid session"
    );
  }

  return { sessionId, sessionUrl };
}

async function getSessionDecision(sessionId) {
  return requestDidit(
    `/v3/session/${encodeURIComponent(sessionId)}/decision/`,
    { method: "GET" }
  );
}

module.exports = { createSession, getSessionDecision };
