import axios from "axios";
import store from "../store";
import { setUser, updateTokens, logout } from "../store/authSlice";

export const authApi = axios.create({
  baseURL: import.meta.env.VITE_AUTH_API,
});

export const userApi = axios.create({
  baseURL: import.meta.env.VITE_USER_API,
});

export const kycApi = axios.create({
  baseURL: import.meta.env.VITE_KYC_API,
});

let refreshPromise = null;

const refreshAccessToken = async () => {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const { refreshToken } = store.getState().auth.tokens;
      if (!refreshToken) throw new Error("No refresh token");

      const { data } = await axios.post(
        `${import.meta.env.VITE_AUTH_API}/auth/refresh`,
        { refreshToken }
      );

      const { accessToken, refreshToken: newRefreshToken, user } = data.data;
      store.dispatch(updateTokens({ accessToken, refreshToken: newRefreshToken }));
      store.dispatch(setUser(user));
      return accessToken;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
};

const attachAuthInterceptors = (instance) => {
  instance.interceptors.request.use((config) => {
    const { accessToken } = store.getState().auth.tokens || {};
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    return config;
  });

  instance.interceptors.response.use(
    (response) => response,
    async (error) => {
      const originalRequest = error.config;

      if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
        const { accessToken } = store.getState().auth.tokens || {};
        if (!accessToken) return Promise.reject(error);

        originalRequest._retry = true;

        try {
          const newToken = await refreshAccessToken();
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          return instance(originalRequest);
        } catch (refreshError) {
          store.dispatch(logout());
          window.location.href = "/";
          return Promise.reject(refreshError);
        }
      }

      return Promise.reject(error);
    }
  );
};

attachAuthInterceptors(authApi);
attachAuthInterceptors(userApi);
attachAuthInterceptors(kycApi);
