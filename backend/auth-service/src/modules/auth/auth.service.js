const userRepository = require("../../repositories/user.repository");
const ApiError = require("../../utils/ApiError");
const {
  hashPassword,
  comparePassword,
  DUMMY_HASH,
} = require("../../utils/password.util");
const { signAccessToken } = require("../../utils/jwt.util");

const toPublicUser = (user) => ({
  id: user.id,
  firstName: user.firstName,
  lastName: user.lastName,
  email: user.email,
  isEmailVerified: user.isEmailVerified,
  createdAt: user.createdAt,
});

const register = async (input) => {
  const email = input.email.toLowerCase();

  const existingUser = await userRepository.findByEmail(email);
  if (existingUser) {
    throw ApiError.conflict(
      "An account with this email already exists",
      "EMAIL_ALREADY_EXISTS"
    );
  }

  const passwordHash = await hashPassword(input.password);

  const user = await userRepository.create({
    firstName: input.firstName,
    lastName: input.lastName,
    email,
    passwordHash,
  });

  return { user: toPublicUser(user) };
};

const login = async (input) => {
  const email = input.email.toLowerCase();
  const user = await userRepository.findByEmail(email);

  const isPasswordValid = await comparePassword(
    input.password,
    user ? user.passwordHash : DUMMY_HASH
  );

  if (!user || !isPasswordValid) {
    throw ApiError.unauthorized(
      "Invalid email or password",
      "INVALID_CREDENTIALS"
    );
  }

  const accessToken = signAccessToken(user);

  return { user: toPublicUser(user), accessToken };
};

const getMe = async (userId) => {
  const user = await userRepository.findById(userId);

  if (!user) {
    throw ApiError.notFound("Account not found", "USER_NOT_FOUND");
  }

  return { user: toPublicUser(user) };
};

module.exports = { register, login, getMe };
