import { userApi } from "./api";

const paymentFromResponse = (response) => response.data.data.payment;

export const initiateDeposit = async ({ amount, idempotencyKey }) => {
  const response = await userApi.post(
    "/payments/deposits",
    { amount },
    { headers: { "Idempotency-Key": idempotencyKey } }
  );
  return paymentFromResponse(response);
};

export const verifyDeposit = async (merchantReference) => {
  const response = await userApi.get(
    `/payments/deposits/${encodeURIComponent(merchantReference)}/verify`
  );
  return paymentFromResponse(response);
};

export const listMyPayments = async ({ limit = 10, cursor } = {}) => {
  const response = await userApi.get("/payments", { params: { limit, cursor } });
  return response.data.data;
};

const withdrawalFromResponse = (response) => response.data.data.withdrawal;

export const initiateWithdrawal = async ({ amount, idempotencyKey }) => {
  const response = await userApi.post(
    "/payments/withdrawals",
    { amount },
    { headers: { "Idempotency-Key": idempotencyKey } }
  );
  return withdrawalFromResponse(response);
};

export const getWithdrawal = async (reference) => {
  const response = await userApi.get(`/payments/withdrawals/${encodeURIComponent(reference)}`);
  return withdrawalFromResponse(response);
};

export const cancelWithdrawal = async (reference) => {
  const response = await userApi.post(
    `/payments/withdrawals/${encodeURIComponent(reference)}/cancel`,
    {}
  );
  return withdrawalFromResponse(response);
};
