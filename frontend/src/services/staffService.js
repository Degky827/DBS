import { userApi } from "./api";

const unwrap = (promise) => promise.then((response) => response.data.data);

export const getAdminOverview = (params) =>
  unwrap(userApi.get("/admin/overview", { params }));

export const getAdminAnalytics = (params) =>
  unwrap(userApi.get("/admin/analytics", { params }));

export const getFinancialAnalytics = (params) =>
  unwrap(userApi.get("/operations/analytics", { params }));

export const listAdminUsers = (params) =>
  unwrap(userApi.get("/admin/users", { params }));

export const getAdminUser = (userId) =>
  unwrap(userApi.get(`/admin/users/${encodeURIComponent(userId)}`));

export const listPlatformTransactions = (params) =>
  unwrap(userApi.get("/operations/transactions", { params }));

export const getPlatformTransaction = (reference) =>
  unwrap(
    userApi.get(`/operations/transactions/${encodeURIComponent(reference)}`)
  );

export const listPlatformPayments = (params) =>
  unwrap(userApi.get("/operations/payments", { params }));

export const listAuditLogs = (params) =>
  unwrap(userApi.get("/admin/audit-logs", { params }));

export const getFinancialPolicies = () =>
  unwrap(userApi.get("/admin/financial-policies"));

export const updateFinancialPolicy = (type, payload) =>
  unwrap(
    userApi.patch(
      `/admin/financial-policies/${encodeURIComponent(type)}`,
      payload
    )
  );

export const runPaymentReconciliation = (payload) =>
  unwrap(userApi.post("/admin/payments/reconciliation", payload));
