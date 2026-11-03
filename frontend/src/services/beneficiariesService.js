import { userApi } from "./api";

const unwrap = (response) => response.data.data;

export const listBeneficiaries = async () => unwrap(await userApi.get("/beneficiaries"));

export const createBeneficiary = async (payload) =>
  unwrap(await userApi.post("/beneficiaries", payload));

export const updateBeneficiary = async (beneficiaryId, payload) =>
  unwrap(await userApi.patch(`/beneficiaries/${encodeURIComponent(beneficiaryId)}`, payload));

export const deleteBeneficiary = async (beneficiaryId) =>
  unwrap(await userApi.delete(`/beneficiaries/${encodeURIComponent(beneficiaryId)}`));
