const RETRYABLE_CODES = new Set(["P1001", "P1017", "P2024"]);

const RETRYABLE_PATTERN =
  /failed with status code|ECONNREFUSED|ETIMEDOUT|EPIPE|EAI_AGAIN|socket hang up|websocket|undici/i;

const isRetryableError = (error) => {
  if (!error) return false;
  if (RETRYABLE_CODES.has(error.code)) return true;
  if (error.type === "ErrorEvent") return true;

  const causeMessage =
    error.cause && error.cause.message ? error.cause.message : "";
  const text = `${error.message || ""} ${causeMessage}`;

  return RETRYABLE_PATTERN.test(text);
};

const withRetry = async (operation, { retries = 3, baseDelayMs = 250 } = {}) => {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt === retries || !isRetryableError(error)) {
        throw error;
      }

      await new Promise((resolve) =>
        setTimeout(resolve, baseDelayMs * 2 ** attempt)
      );
    }
  }

  throw lastError;
};

module.exports = { withRetry, isRetryableError };
