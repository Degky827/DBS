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
});

module.exports = ROUTES;
