const toPublicUser = (user) => ({
  id: user.id,
  firstName: user.firstName,
  middleName: user.middleName,
  lastName: user.lastName,
  username: user.username,
  dateOfBirth: user.dateOfBirth,
  gender: user.gender,
  phoneNumber: user.phoneNumber,
  email: user.email,
  role: user.role,
  isEmailVerified: user.isEmailVerified,
  status: user.status || "ACTIVE",
  mfaEnabled: user.mfaEnabled === true,
  createdAt: user.createdAt,
});

module.exports = { toPublicUser };
