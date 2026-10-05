import axios from "axios";

export const authApi = axios.create({
  baseURL: import.meta.env.VITE_AUTH_API,
});

export const userApi = axios.create({
  baseURL: import.meta.env.VITE_USER_API,
});