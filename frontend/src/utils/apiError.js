// Normalizes errors from the auth, user and KYC services into a single shape.
// Backend envelope: { success, message, errors? } — `errors` is a map of
// field -> string (auth/user) or field -> string[] (kyc). Error `code` values
// are never returned in the body, so we branch on HTTP status + message.
export const normalizeApiError = (error) => {
  const fallback = "Something went wrong. Please try again.";

  if (!error?.response) {
    if (error?.code === "ECONNABORTED") {
      return { status: 0, message: "The request timed out. Check your connection and try again.", fields: {} };
    }
    return { status: 0, message: "Unable to reach the server. Check your connection and try again.", fields: {} };
  }

  const { status, data } = error.response;
  const message =
    (typeof data?.message === "string" && data.message) ||
    (status === 429
      ? "Too many requests. Please wait a moment and try again."
      : status >= 500
        ? "The server encountered a problem. Please try again shortly."
        : fallback);

  const fields = {};
  const raw = data?.errors;
  if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "string") fields[key] = value;
      else if (Array.isArray(value) && typeof value[0] === "string") fields[key] = value[0];
      else if (value && typeof value.message === "string") fields[key] = value.message;
    }
  }

  return { status, message, fields };
};

export const apiErrorMessage = (error, fallback) => {
  const normalized = normalizeApiError(error);
  return fallback && normalized.status === 0 && normalized.message.includes("Unable to reach")
    ? fallback
    : normalized.message;
};
