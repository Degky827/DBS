import axios from "axios";
import store from "../store";
import { setSession, clearSession, setStatus } from "../store/authSlice";

// The refresh endpoint authenticates with the HttpOnly cookie only. This
// client never reads or stores the refresh token in JavaScript.
const refreshClient = axios.create({
  baseURL: import.meta.env.VITE_AUTH_API,
  withCredentials: true,
  timeout: 15000,
});

let refreshPromise = null;
let bootstrapPromise = null;
let bootstrapped = false;

const isRefreshRace = (error) =>
  error?.response?.status === 409 &&
  error?.response?.data?.code === "REFRESH_RACE";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const requestRefresh = () => refreshClient.post("/auth/refresh");

// Rotates the refresh cookie and stores the new in-memory access token.
// Concurrent callers within this tab share one request so the single-use
// refresh cookie is not rotated twice.
export const refreshSession = async () => {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    let response;

    try {
      response = await requestRefresh();
    } catch (error) {
      if (!isRefreshRace(error)) throw error;

      // Another tab won the rotation race and received the successor cookie.
      // Retry once using the cookie the browser now holds.
      await delay(150);
      response = await requestRefresh();
    }

    const { user, accessToken } = response.data.data;
    store.dispatch(setSession({ user, accessToken }));
    return accessToken;
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
};

// Reconstructs the session on page load. The refresh cookie is the only
// persistent credential; there is no token in localStorage or sessionStorage.
export const bootstrapSession = async () => {
  if (bootstrapPromise) return bootstrapPromise;
  if (bootstrapped) return store.getState().auth.status === "authenticated";
  bootstrapped = true;

  bootstrapPromise = (async () => {
    store.dispatch(setStatus("checking"));
    try {
      await refreshSession();
      return true;
    } catch {
      store.dispatch(clearSession());
      return false;
    } finally {
      bootstrapPromise = null;
    }
  })();

  return bootstrapPromise;
};
