import { authApi } from "./api";
import store from "../store";
import { setCredentials, logout } from "../store/authSlice";

export const loginUser = async (email, password) => {
  const { data } = await authApi.post("/auth/login", { email, password });
  const { user, accessToken, refreshToken } = data.data;
  store.dispatch(setCredentials({ user, accessToken, refreshToken }));
  return data.data;
};

export const registerUser = async (formData) => {
  const payload = {
    firstName: formData.firstName,
    middleName: formData.middleName || undefined,
    lastName: formData.lastName,
    username: formData.username,
    dateOfBirth: formData.dateOfBirth,
    gender: formData.gender,
    phoneNumber: formData.phoneNumber,
    email: formData.email,
    password: formData.password,
    confirmPassword: formData.confirmPassword,
    securityQuestion: formData.securityQuestion,
    securityAnswer: formData.securityAnswer,
    acceptedTerms: true,
  };
  const { data } = await authApi.post("/auth/register", payload);
  return data.data;
};

export const verifyEmail = async (email, otp) => {
  const { data } = await authApi.post("/auth/verify-email", { email, otp });
  return data.data;
};

export const resendOtp = async (email) => {
  const { data } = await authApi.post("/auth/resend-otp", { email });
  return data;
};

export const getMe = async () => {
  const { data } = await authApi.get("/auth/me");
  return data.data;
};

export const forgotPassword = async (email) => {
  const { data } = await authApi.post("/auth/forgot-password", { email });
  return data;
};

export const resetPassword = async (email, otp, newPassword, confirmNewPassword) => {
  const { data } = await authApi.post("/auth/reset-password", {
    email,
    otp,
    newPassword,
    confirmNewPassword,
  });
  return data;
};

export const logoutUser = async () => {
  try {
    const { refreshToken } = store.getState().auth.tokens || {};
    if (refreshToken) {
      await authApi.post("/auth/logout", { refreshToken });
    }
  } catch {
    // ignore network errors on logout
  } finally {
    store.dispatch(logout());
  }
};
