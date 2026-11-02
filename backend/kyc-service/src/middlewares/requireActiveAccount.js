const ApiError = require("../utils/ApiError");

const MESSAGES = Object.freeze({
  FROZEN: "This account is frozen; identity verification changes are disabled",
  SUSPENDED: "This account is suspended",
  CLOSED: "This account has been closed",
});

// Frozen accounts may still view their KYC status but cannot create, upload,
// or modify submissions. Suspended and closed accounts never get here because
// introspection rejects their tokens.
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
