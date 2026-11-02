const API_PREFIX = "/api/v1";

const ROUTES = Object.freeze({
  API_PREFIX,
  HEALTH: "/health",
  READY: "/ready",
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
    NOTIFICATION_PREFERENCES: "/me/notification-preferences",
    MFA: "/mfa",
    MFA_SETUP: "/mfa/setup",
    MFA_SETUP_CONFIRM: "/mfa/setup/confirm",
    MFA_DISABLE: "/mfa/disable",
    MFA_VERIFY: "/mfa/verify",
    MFA_STEP_UP: "/mfa/step-up",
  }),
  INTERNAL: Object.freeze({
    CHANGE_PASSWORD: "/users/change-password",
    INTROSPECT_TOKEN: "/tokens/introspect",
    ACCOUNT_STATUS: "/users/status",
    ACCOUNT_STATUSES: "/users/statuses",
    CLOSE_ACCOUNT: "/users/close",
    RESET_MFA: "/users/mfa/reset",
  }),
});

module.exports = ROUTES;
