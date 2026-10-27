import { userApi } from "./api";
import store from "../store";

// Maps backend gender enums to display labels used across the profile UI.
export const GENDER_LABELS = {
  male: "Male",
  female: "Female",
  other: "Other",
  prefer_not_to_say: "Prefer not to say",
};

export const GENDER_OPTIONS = [
  { value: "", label: "Select gender" },
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

const mergeProfileWithAuthUser = (user = null) => {
  const authUser = store.getState().auth?.user || {};
  if (!user && !authUser) return null;

  const merged = {
    ...authUser,
    ...user,
    firstName: user?.firstName || authUser.firstName || "",
    middleName: user?.middleName ?? authUser.middleName ?? "",
    lastName: user?.lastName || authUser.lastName || "",
    username: user?.username || authUser.username || "",
    email: user?.email || authUser.email || "",
    phoneNumber: user?.phoneNumber || authUser.phoneNumber || "",
    dateOfBirth: user?.dateOfBirth || authUser.dateOfBirth || null,
    gender: user?.gender || authUser.gender || "prefer_not_to_say",
    role: user?.role || authUser.role || "USER",
  };

  return merged;
};

// All requests go through `userApi`, which attaches the JWT and transparently
// refreshes an expired access token (see services/api.js interceptors).
export const getMyProfile = async () => {
  const { data } = await userApi.get("/users/me");
  return normalizeProfile(mergeProfileWithAuthUser(data.data.user));
};

const normalizeProfile = (user) => {
  if (!user) return user;
  if (!user?.avatarUrl?.startsWith("/uploads/avatars/")) return user;
  const apiBase = new URL(userApi.defaults.baseURL, window.location.origin);
  return { ...user, avatarUrl: new URL(user.avatarUrl, `${apiBase.origin}/`).toString() };
};

export const updateProfile = async (payload, avatarFile) => {
  let requestBody = payload;
  if (avatarFile) {
    requestBody = new FormData();
    for (const [key, value] of Object.entries(payload)) {
      requestBody.append(key, value);
    }
    requestBody.append("avatar", avatarFile);
  }

  const { data } = await userApi.patch("/users/me", requestBody);
  return normalizeProfile(data.data.user);
};

export const changePassword = async ({
  currentPassword,
  newPassword,
  confirmNewPassword,
}) => {
  const { data } = await userApi.patch("/users/me/password", {
    currentPassword,
    newPassword,
    confirmNewPassword,
  });
  return data;
};

// Converts an ISO date to the YYYY-MM-DD value expected by <input type="date">.
export const toDateInputValue = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
};
