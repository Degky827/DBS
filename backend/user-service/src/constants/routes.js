const API_PREFIX = "/api/v1";

const ROUTES = Object.freeze({
  API_PREFIX,
  HEALTH: "/health",
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
  }),
  PAYMENTS: Object.freeze({
    DEPOSITS: "/payments/deposits",
    DEPOSITS_VERIFY: "/payments/deposits/:reference/verify",
    WITHDRAWALS: "/payments/withdrawals",
    WEBHOOK: "/payments/webhook",
  }),
});

module.exports = ROUTES;
