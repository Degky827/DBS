const bcrypt = require("bcryptjs");
const env = require("../config/env");
const ApiError = require("./ApiError");

const DUMMY_HASH =
  "$2b$12$1vCof1fUeF6CPWOKFBNLF.BU21/iTh4KmIykodqdjexxykaxfhlby";

const hashPassword = async (plainPassword) => {
  return bcrypt.hash(plainPassword, env.BCRYPT_ROUNDS);
};

const comparePassword = async (plainPassword, passwordHash) => {
  try {
    return await bcrypt.compare(plainPassword, passwordHash);
  } catch (error) {
    throw ApiError.internal("Unable to verify password");
  }
};

module.exports = { hashPassword, comparePassword, DUMMY_HASH };
