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
    OVERVIEW: "/admin/overview",
    ANALYTICS: "/admin/analytics",
    USERS: "/admin/users",
    USER_BY_ID: "/admin/users/:userId",
    AUDIT_LOGS: "/admin/audit-logs",
    FINANCIAL_POLICIES: "/admin/financial-policies",
    FINANCIAL_POLICY: "/admin/financial-policies/:type",
    PAYMENT_RECONCILIATION: "/admin/payments/reconciliation",
  }),
  OPERATIONS: Object.freeze({
    ANALYTICS: "/operations/analytics",
    TRANSACTIONS: "/operations/transactions",
    TRANSACTION_BY_REFERENCE: "/operations/transactions/:reference",
    PAYMENTS: "/operations/payments",
  }),
  PAYMENTS: Object.freeze({
    ROOT: "/payments",
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
