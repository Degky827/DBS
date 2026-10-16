const prisma = require("../config/database");
const { withRetry } = require("../utils/withRetry");

const userRepository = {
  findByEmail(email) {
    return withRetry(() => prisma.userProfile.findUnique({ where: { email } }));
  },

  findById(id) {
    return withRetry(() => prisma.userProfile.findUnique({ where: { id } }));
  },

  findProfileById(id) {
    return withRetry(() =>
      prisma.userProfile.findUnique({
        where: { id },
        select: {
          id: true,
          firstName: true,
          middleName: true,
          lastName: true,
          username: true,
          email: true,
          phoneNumber: true,
          dateOfBirth: true,
          gender: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          state: true,
          postalCode: true,
          country: true,
          bio: true,
          avatarUrl: true,
          role: true,
          passwordChangedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      })
    );
  },

  updateProfile(id, data) {
    return withRetry(() =>
      prisma.userProfile.update({ where: { id }, data })
    );
  },

  updatePassword(id, passwordHash) {
    return withRetry(() =>
      prisma.userProfile.update({
        where: { id },
        data: { passwordHash, passwordChangedAt: new Date() },
      })
    );
  },
};

module.exports = userRepository;
