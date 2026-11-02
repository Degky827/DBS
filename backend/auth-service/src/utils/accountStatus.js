const ApiError = require("./ApiError");

const ACCOUNT_STATUSES = Object.freeze([
  "ACTIVE",
  "FROZEN",
  "SUSPENDED",
  "CLOSED",
]);

const isClosed = (user) => user?.status === "CLOSED";

// FROZEN accounts may still authenticate for read-only access; SUSPENDED and
// CLOSED accounts cannot establish or continue a session.
const assertAuthenticatable = (user) => {
  if (user?.status === "SUSPENDED") {
    throw ApiError.forbidden(
      "This account is suspended. Contact support for assistance.",
      "ACCOUNT_SUSPENDED"
    );
  }
  if (isClosed(user)) {
    throw ApiError.forbidden("This account has been closed.", "ACCOUNT_CLOSED");
  }
};

const assertTokenUsable = (user) => {
  if (user?.status === "SUSPENDED") {
    throw ApiError.unauthorized(
      "This account is suspended",
      "ACCOUNT_SUSPENDED"
    );
  }
  if (isClosed(user)) {
    throw ApiError.unauthorized("This account has been closed", "ACCOUNT_CLOSED");
  }
};

module.exports = {
  ACCOUNT_STATUSES,
  isClosed,
  assertAuthenticatable,
  assertTokenUsable,
};
