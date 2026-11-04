import { userApi } from "./api";

const unwrap = (response) => response.data.data;

export const listScheduledTransfers = async ({ status, limit = 25, cursor } = {}) =>
  unwrap(
    await userApi.get("/scheduled-transfers", {
      params: { ...(status ? { status } : {}), limit, ...(cursor ? { cursor } : {}) },
    })
  );

export const createScheduledTransfer = async (payload) =>
  unwrap(await userApi.post("/scheduled-transfers", payload));

export const getScheduledTransfer = async (scheduleId) =>
  unwrap(await userApi.get(`/scheduled-transfers/${encodeURIComponent(scheduleId)}`));

const action = async (scheduleId, verb) =>
  unwrap(await userApi.post(`/scheduled-transfers/${encodeURIComponent(scheduleId)}/${verb}`, {}));

export const pauseScheduledTransfer = (scheduleId) => action(scheduleId, "pause");
export const resumeScheduledTransfer = (scheduleId) => action(scheduleId, "resume");
export const cancelScheduledTransfer = (scheduleId) => action(scheduleId, "cancel");
