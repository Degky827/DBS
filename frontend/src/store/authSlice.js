import { createSlice } from "@reduxjs/toolkit";

const TOKEN_KEY = "meridian_tokens";
const USER_KEY = "meridian_user";

const loadInitial = () => {
  try {
    const tokens = JSON.parse(localStorage.getItem(TOKEN_KEY));
    const user = JSON.parse(localStorage.getItem(USER_KEY));
    return { tokens, user, isAuthenticated: !!tokens?.accessToken };
  } catch {
    return { tokens: null, user: null, isAuthenticated: false };
  }
};

const authSlice = createSlice({
  name: "auth",
  initialState: loadInitial(),
  reducers: {
    setCredentials(state, action) {
      const { user, accessToken, refreshToken } = action.payload;
      state.user = user;
      state.tokens = { accessToken, refreshToken };
      state.isAuthenticated = true;
      localStorage.setItem(TOKEN_KEY, JSON.stringify(state.tokens));
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    },
    updateTokens(state, action) {
      const { accessToken, refreshToken } = action.payload;
      state.tokens = { accessToken, refreshToken };
      localStorage.setItem(TOKEN_KEY, JSON.stringify(state.tokens));
    },
    setUser(state, action) {
      state.user = action.payload;
      localStorage.setItem(USER_KEY, JSON.stringify(action.payload));
    },
    logout(state) {
      state.user = null;
      state.tokens = null;
      state.isAuthenticated = false;
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    },
  },
});

export const { setCredentials, updateTokens, setUser, logout } = authSlice.actions;
export default authSlice.reducer;
