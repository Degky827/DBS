const ApiError = require("../utils/ApiError");

const MESSAGES = Object.freeze({
  FROZEN: "This account is frozen; financial operations are disabled",
  SUSPENDED: "This account is suspended",
  CLOSED: "This account has been closed",
});

// Must run after authenticate. Frozen accounts keep read-only access; suspended
// and closed accounts never reach handlers because introspection rejects them.
module.exports = function requireActiveAccount(req, res, next) {
  const status = req.user?.accountStatus || "ACTIVE";

  if (status === "ACTIVE") return next();

  return next(
    ApiError.forbidden(
      MESSAGES[status] || "This account cannot perform this operation",
      `ACCOUNT_${status}`
    )
  );
};
