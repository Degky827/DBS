const ApiResponse = require("../../utils/ApiResponse");
const usersService = require("../users/users.service");
const walletsService = require("./wallets.service");

const createWallet = async (req, res) => {
  const userId = await usersService.getResolvedUserId(req.user);
  const result = await walletsService.createWallet(userId);
  return ApiResponse.success(res, result, "Wallet created", 201);
};

const getMyWallet = async (req, res) => {
  const userId = await usersService.getResolvedUserId(req.user);
  const result = await walletsService.getMyWallet(userId);
  return ApiResponse.success(res, result, "Wallet fetched");
};

const getWalletById = async (req, res) => {
  const userId = await usersService.getResolvedUserId(req.user);
  const result = await walletsService.getWalletById(userId, req.params.walletId);
  return ApiResponse.success(res, result, "Wallet fetched");
};

module.exports = { createWallet, getMyWallet, getWalletById };