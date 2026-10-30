import axios from "axios";
import store from "../store";
import { clearSession } from "../store/authSlice";
import { refreshSession } from "./session";

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
];

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
