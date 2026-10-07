const prisma = require("../config/database");
const { withRetry } = require("../utils/withRetry");

const userRepository = {
  findByEmail(email) {
    return withRetry(() => prisma.user.findUnique({ where: { email } }));
  },

  findByUsername(username) {
    return withRetry(() => prisma.user.findUnique({ where: { username } }));
  },

  findById(id) {
    return withRetry(() => prisma.user.findUnique({ where: { id } }));
  },

  markEmailVerified(id) {
    return withRetry(() =>
      prisma.user.update({ where: { id }, data: { isEmailVerified: true } })
    );
  },

  create(data) {
    return withRetry(() => prisma.user.create({ data }));
  },
};

module.exports = userRepository;
