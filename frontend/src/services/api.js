import axios from "axios";
import store from "../store";
import { clearSession } from "../store/authSlice";
import { refreshSession } from "./session";
import { requestStepUp } from "./stepUp";

const createApi = (baseURL, { withCredentials = false } = {}) =>
  axios.create({ baseURL, withCredentials, timeout: 20000 });

export const authApi = createApi(import.meta.env.VITE_AUTH_API, {
  withCredentials: true,
});
export const userApi = createApi(import.meta.env.VITE_USER_API);
export const kycApi = createApi(import.meta.env.VITE_KYC_API);

// These endpoints either establish a session or are the refresh/logout calls
// themselves. A 401 from them must never trigger another refresh attempt.
const SESSION_ENDPOINTS = [
  "/auth/login",
  "/auth/refresh",
  "/auth/logout",
  "/auth/register",
  "/auth/verify-email",
  "/auth/resend-otp",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/mfa/verify",
];

const STEP_UP_CODES = new Set(["STEP_UP_REQUIRED", "MFA_REQUIRED"]);

const isSessionEndpoint = (url = "") =>
  SESSION_ENDPOINTS.some((endpoint) => url.includes(endpoint));

const attachAuthInterceptors = (instance) => {
  instance.interceptors.request.use((config) => {
    const { accessToken } = store.getState().auth;
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    return config;
  });

  instance.interceptors.response.use(
    (response) => response,
    async (error) => {
      const originalRequest = error.config;
      const status = error.response?.status;
      const code = error.response?.data?.code;

      if (
        status === 403 &&
        STEP_UP_CODES.has(code) &&
        originalRequest &&
        !originalRequest._stepUpRetry &&
        !originalRequest.url?.includes("/auth/mfa/")
      ) {
        originalRequest._stepUpRetry = true;
        try {
          const accessToken = await requestStepUp();
          originalRequest.headers = {
            ...originalRequest.headers,
            Authorization: `Bearer ${accessToken}`,
          };
          return instance(originalRequest);
        } catch (stepUpError) {
          // Cancelling the prompt is a deliberate choice, not a network
          // failure; report it as such instead of the generic connectivity
          // message produced for errors without a response.
          if (stepUpError?.message === "Step-up verification cancelled") {
            return Promise.reject({
              ...error,
              response: {
                status: 403,
                data: {
                  success: false,
                  message: "Verification was cancelled. Your request was not completed.",
                  code: "STEP_UP_CANCELLED",
                },
              },
            });
          }
          return Promise.reject(error);
        }
      }

      if (
        status !== 401 ||
        !originalRequest ||
        originalRequest._retry ||
        isSessionEndpoint(originalRequest.url)
      ) {
        return Promise.reject(error);
      }

      originalRequest._retry = true;

      try {
        const accessToken = await refreshSession();
        originalRequest.headers = {
          ...originalRequest.headers,
          Authorization: `Bearer ${accessToken}`,
        };
        return instance(originalRequest);
      } catch (refreshError) {
        // A failed refresh means the session is gone. Routing components
        // react to the cleared state; no hard reload or retry loop is used.
        store.dispatch(clearSession());
        return Promise.reject(refreshError);
      }
    }
  );
};

attachAuthInterceptors(authApi);
attachAuthInterceptors(userApi);
attachAuthInterceptors(kycApi);
