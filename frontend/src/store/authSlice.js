import { createSlice } from "@reduxjs/toolkit";

// Access tokens live only in memory. The refresh token is kept in an
// HttpOnly cookie set by auth-service and is never readable from JavaScript.
// The session is reconstructed on reload by calling /auth/refresh.
const initialState = {
  user: null,
  accessToken: null,
  status: "checking",
  isAuthenticated: false,
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    setSession(state, action) {
      const { user, accessToken } = action.payload;
      state.user = user;
      state.accessToken = accessToken;
      state.status = "authenticated";
      state.isAuthenticated = true;
    },
    setUser(state, action) {
      state.user = action.payload;
    },
    setStatus(state, action) {
      state.status = action.payload;
    },
    clearSession(state) {
      state.user = null;
      state.accessToken = null;
      state.status = "anonymous";
      state.isAuthenticated = false;
    },
  },
});

export const { setSession, setUser, setStatus, clearSession } = authSlice.actions;
export default authSlice.reducer;
