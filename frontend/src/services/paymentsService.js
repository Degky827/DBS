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
