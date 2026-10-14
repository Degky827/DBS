const userRepository = require("../../repositories/user.repository");
const devSessionRepository = require("../../repositories/devSession.repository");
const ApiError = require("../../utils/ApiError");
const audit = require("../../utils/audit");
const {
  hashPassword,
  comparePassword,
  DUMMY_HASH,
} = require("../../utils/password.util");

const toPublicProfile = (user) => ({
  id: user.id,
  firstName: user.firstName,
  middleName: user.middleName,
  lastName: user.lastName,
  username: user.username,
  email: user.email,
  phoneNumber: user.phoneNumber,
  dateOfBirth: user.dateOfBirth,
  gender: user.gender,
  addressLine1: user.addressLine1,
  addressLine2: user.addressLine2,
  city: user.city,
  state: user.state,
  postalCode: user.postalCode,
  country: user.country,
  bio: user.bio,
  avatarUrl: user.avatarUrl,
  role: user.role,
  passwordChangedAt: user.passwordChangedAt,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const UPDATABLE_FIELDS = [
  "firstName",
  "middleName",
  "lastName",
  "phoneNumber",
  "gender",
  "dateOfBirth",
  "addressLine1",
  "addressLine2",
  "city",
  "state",
  "postalCode",
  "country",
  "bio",
  "avatarUrl",
];

const getMyProfile = async (userId) => {
  const user = await userRepository.findProfileById(userId);

  if (!user) {
    throw ApiError.notFound("Account not found", "USER_NOT_FOUND");
  }

  return { user: toPublicProfile(user) };
};

const updateMyProfile = async (userId, input) => {
  const user = await userRepository.findById(userId);

  if (!user) {
    throw ApiError.notFound("Account not found", "USER_NOT_FOUND");
  }

  const data = {};

  for (const field of UPDATABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      if (field === "dateOfBirth") {
        data[field] = new Date(input[field]);
      } else if (field === "middleName" && input[field] === "") {
        data[field] = null;
      } else {
        data[field] = input[field];
      }
    }
  }

  if (Object.keys(data).length === 0) {
    throw ApiError.badRequest(
      "At least one profile field must be provided",
      "EMPTY_UPDATE"
    );
  }

  await userRepository.updateProfile(userId, data);
  const updated = await userRepository.findProfileById(userId);

  if (!updated) {
    throw ApiError.notFound("Account not found", "USER_NOT_FOUND");
  }

  audit("PROFILE_UPDATED", { userId, fields: Object.keys(data) });

  return { user: toPublicProfile(updated) };
};

const changeMyPassword = async (userId, input, session) => {
  const user = await userRepository.findById(userId);

  if (!user) {
    throw ApiError.notFound("Account not found", "USER_NOT_FOUND");
  }

  const isCurrentValid = await comparePassword(
    input.currentPassword,
    user.passwordHash || DUMMY_HASH
  );

  if (!isCurrentValid) {
    audit("PASSWORD_CHANGE_FAILED", { userId });
    throw ApiError.unauthorized(
      "Current password is incorrect",
      "INVALID_CURRENT_PASSWORD"
    );
  }

  if (input.currentPassword === input.newPassword) {
    throw ApiError.badRequest(
      "New password must be different from the current password",
      "PASSWORD_REUSE"
    );
  }

  const passwordHash = await hashPassword(input.newPassword);
  await userRepository.updatePassword(userId, passwordHash);

  if (session) {
    await devSessionRepository.revokeAllForUserExcept(userId, session.id);
  }

  audit("PASSWORD_CHANGED", { userId });

  return {
    message:
      "Password has been changed. Other development sessions were revoked.",
  };
};

module.exports = {
  getMyProfile,
  updateMyProfile,
  changeMyPassword,
  toPublicProfile,
};
