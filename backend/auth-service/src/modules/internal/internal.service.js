const userRepository = require("../../repositories/user.repository");
const refreshTokenRepository = require("../../repositories/refreshToken.repository");
const ApiError = require("../../utils/ApiError");
const audit = require("../../utils/audit");
const {
  comparePassword,
  hashPassword,
  DUMMY_HASH,
} = require("../../utils/password.util");

// Internal-only password change, invoked by user-service (Phase 2) when a
// user updates their password through the integrated profile flow. auth-service
// remains the single source of truth for credentials.
const changePasswordForUser = async ({ email, currentPassword, newPassword }) => {
  const user = await userRepository.findByEmail(email);

  if (!user) {
    throw ApiError.notFound("Account not found", "USER_NOT_FOUND");
  }

  const isCurrentValid = await comparePassword(
    currentPassword,
    user.passwordHash || DUMMY_HASH
  );

  if (!isCurrentValid) {
    audit("PASSWORD_CHANGE_FAILED", { userId: user.id, via: "internal" });
    throw ApiError.unauthorized(
      "Current password is incorrect",
      "INVALID_CURRENT_PASSWORD"
    );
  }

  const passwordHash = await hashPassword(newPassword);
  await userRepository.updatePassword(user.id, passwordHash);

  // Invalidate every active session so the change takes effect everywhere.
  await refreshTokenRepository.revokeAllForUser(user.id);

  audit("PASSWORD_CHANGED", { userId: user.id, via: "internal" });

  return { message: "Password has been changed. Other sessions were revoked." };
};

module.exports = { changePasswordForUser };
