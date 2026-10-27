import { userApi } from "./api";

const walletFromResponse = (response) => response.data.data.wallet;

export const getMyWallet = async () => {
  const response = await userApi.get("/wallets/me");
  return walletFromResponse(response);
};

export const createMyWallet = async () => {
  const response = await userApi.post("/wallets", {});
  return walletFromResponse(response);
};

export const transferFunds = async ({
  destinationWalletId,
  amount,
  idempotencyKey,
}) => {
  const response = await userApi.post(
    "/transactions/transfers",
    { destinationWalletId, amount },
    { headers: { "Idempotency-Key": idempotencyKey } }
  );
  return {
    transaction: response.data.data.transaction,
    replayed: response.status === 200,
  };
};

export const listMyTransactions = async ({
  limit = 25,
  cursor,
  direction = "all",
  from,
  to,
} = {}) => {
  const response = await userApi.get("/transactions", {
    params: { limit, cursor, direction, from, to },
  });
  return response.data.data;
};
