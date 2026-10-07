const API_PREFIX = "/api/v1";

const ROUTES = Object.freeze({
  API_PREFIX,
  HEALTH: "/health",
  AUTH: Object.freeze({
    REGISTER: "/register",
    LOGIN: "/login",
    ME: "/me",
    VERIFY_EMAIL: "/verify-email",
    RESEND_OTP: "/resend-otp",
  }),
});

module.exports = ROUTES;
