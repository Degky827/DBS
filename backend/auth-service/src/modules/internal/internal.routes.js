const router = require("express").Router();

const ROUTES = require("../../constants/routes");
const validate = require("../../middlewares/validate");
const authenticateInternal = require("../../middlewares/authenticateInternal");
const internalController = require("./internal.controller");
const {
  changePasswordSchema,
  introspectTokenSchema,
  accountStatusSchema,
  accountStatusesSchema,
  resetMfaSchema,
  closeAccountSchema,
} = require("./internal.validation");

router.post(
  ROUTES.INTERNAL.CHANGE_PASSWORD,
  authenticateInternal,
  validate(changePasswordSchema),
  internalController.changePassword
);

// Lets downstream services reject access tokens whose session was revoked
// between issuance and expiry. Identity is still read from the token itself;
// this only reports whether it is still active.
router.post(
  ROUTES.INTERNAL.INTROSPECT_TOKEN,
  authenticateInternal,
  validate(introspectTokenSchema),
  internalController.introspectToken
);

// Account lifecycle control is owned by auth-service so credential state and
// session revocation stay in one place. user-service calls these endpoints.
router.post(
  ROUTES.INTERNAL.ACCOUNT_STATUS,
  authenticateInternal,
  validate(accountStatusSchema),
  internalController.updateAccountStatus
);

router.post(
  ROUTES.INTERNAL.ACCOUNT_STATUSES,
  authenticateInternal,
  validate(accountStatusesSchema),
  internalController.getAccountStatuses
);

router.post(
  ROUTES.INTERNAL.RESET_MFA,
  authenticateInternal,
  validate(resetMfaSchema),
  internalController.resetMfa
);

// Self-service closure: user-service has already checked that the wallet is
// settled, then delegates the credential check and status change here.
router.post(
  ROUTES.INTERNAL.CLOSE_ACCOUNT,
  authenticateInternal,
  validate(closeAccountSchema),
  internalController.closeAccount
);

module.exports = router;
