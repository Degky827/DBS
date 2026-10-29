import { authApi } from "./api";
import store from "../store";
import { setSession, clearSession } from "../store/authSlice";

export const loginUser = async (email, password) => {
  const { data } = await authApi.post("/auth/login", { email, password });
  // auth-service sets the refresh token as an HttpOnly cookie and returns
  // only the short-lived access token to JavaScript.
  const { user, accessToken } = data.data;
  store.dispatch(setSession({ user, accessToken }));
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
    // The refresh cookie is sent automatically; the server revokes the token
    // family and clears the cookie.
    await authApi.post("/auth/logout");
  } catch {
    // Local state is cleared even when the server cannot be reached.
  } finally {
    store.dispatch(clearSession());
  }
};
