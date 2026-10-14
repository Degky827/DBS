const prisma = require("../config/database");
const { withRetry } = require("../utils/withRetry");

const userRepository = {
  findByEmail(email) {
    return withRetry(() => prisma.userProfile.findUnique({ where: { email } }));
  },

  findById(id) {
    return withRetry(() => prisma.userProfile.findUnique({ where: { id } }));
  },

  findByUsername(username) {
    return withRetry(() =>
      prisma.userProfile.findUnique({ where: { username } })
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
