const API_PREFIX = "/api/v1";

const ROUTES = Object.freeze({
  API_PREFIX,
  HEALTH: "/health",
  DOCS: "/docs",
  OPENAPI: "/openapi.json",
  OPENAPI_YAML: "/openapi.yaml",
  AUTH: Object.freeze({
    REGISTER: "/register",
    LOGIN: "/login",
    ME: "/me",
    VERIFY_EMAIL: "/verify-email",
    RESEND_OTP: "/resend-otp",
    REFRESH: "/refresh",
    LOGOUT: "/logout",
    FORGOT_PASSWORD: "/forgot-password",
    RESET_PASSWORD: "/reset-password",
  }),
});

module.exports = ROUTES;
