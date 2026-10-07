const prisma = require("../config/database");
const { withRetry } = require("../utils/withRetry");

const userRepository = {
  findByEmail(email) {
    return withRetry(() => prisma.user.findUnique({ where: { email } }));
  },

  findById(id) {
    return withRetry(() => prisma.user.findUnique({ where: { id } }));
  },

  findByUsername(username) {
    return withRetry(() => prisma.user.findUnique({ where: { username } }));
  },

  markEmailVerified(id) {
    return withRetry(() =>
      prisma.user.update({ where: { id }, data: { isEmailVerified: true } })
    );
  },

  updatePassword(id, passwordHash) {
    return withRetry(() =>
      prisma.user.update({ where: { id }, data: { passwordHash } })
    );
  },

  create(data) {
    return withRetry(() => prisma.user.create({ data }));
  },
};

module.exports = userRepository;
