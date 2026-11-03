import { userApi } from "./api";

const unwrap = (response) => response.data.data;

export const openDispute = async (payload) => unwrap(await userApi.post("/disputes", payload));

export const listMyDisputes = async ({ status, q, limit = 25, cursor } = {}) =>
  unwrap(
    await userApi.get("/disputes", {
      params: {
        ...(status ? { status } : {}),
        ...(q ? { q } : {}),
        limit,
        ...(cursor ? { cursor } : {}),
      },
    })
  );

export const getMyDispute = async (reference) =>
  unwrap(await userApi.get(`/disputes/${encodeURIComponent(reference)}`));

export const listAllDisputes = async ({ status, q, limit = 25, cursor } = {}) =>
  unwrap(
    await userApi.get("/admin/disputes", {
      params: {
        ...(status ? { status } : {}),
        ...(q ? { q } : {}),
        limit,
        ...(cursor ? { cursor } : {}),
      },
    })
  );

export const getDisputeForStaff = async (reference) =>
  unwrap(await userApi.get(`/admin/disputes/${encodeURIComponent(reference)}`));

export const updateDispute = async (reference, payload) =>
  unwrap(await userApi.patch(`/admin/disputes/${encodeURIComponent(reference)}`, payload));
