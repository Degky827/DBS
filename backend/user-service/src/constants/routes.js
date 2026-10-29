const API_PREFIX = "/api/v1";

const ROUTES = Object.freeze({
  API_PREFIX,
  HEALTH: "/health",
  READY: "/ready",
  DOCS: "/docs",
  OPENAPI: "/openapi.json",
  AUTH: Object.freeze({
    DEV_LOGIN: "/auth/dev-login",
    DEV_LOGOUT: "/auth/dev-logout",
  }),
  USERS: Object.freeze({
    ME: "/users/me",
    ME_PASSWORD: "/users/me/password",
  }),
  WALLETS: Object.freeze({
    ROOT: "/wallets",
    ME: "/wallets/me",
    BY_ID: "/wallets/:walletId",
  }),
  TRANSACTIONS: Object.freeze({
    ROOT: "/transactions",
    TRANSFERS: "/transactions/transfers",
    BY_REFERENCE: "/transactions/:reference",
    REVERSALS: "/transactions/:reference/reversals",
  }),
  ADMIN: Object.freeze({
    FINANCIAL_POLICIES: "/admin/financial-policies",
    FINANCIAL_POLICY: "/admin/financial-policies/:type",
    PAYMENT_RECONCILIATION: "/admin/payments/reconciliation",
  }),
  PAYMENTS: Object.freeze({
    DEPOSITS: "/payments/deposits",
    DEPOSITS_VERIFY: "/payments/deposits/:reference/verify",
    DEPOSIT_REFUNDS: "/payments/deposits/:reference/refunds",
    WITHDRAWALS: "/payments/withdrawals",
    WITHDRAWAL_BY_REFERENCE: "/payments/withdrawals/:reference",
    WITHDRAWAL_CANCEL: "/payments/withdrawals/:reference/cancel",
    WEBHOOK: "/payments/webhook",
  }),
});

module.exports = ROUTES;
