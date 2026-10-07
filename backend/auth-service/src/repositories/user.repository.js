const prisma = require("../config/database");
const { withRetry } = require("../utils/withRetry");

const userRepository = {
  findByEmail(email) {
    return withRetry(() => prisma.user.findUnique({ where: { email } }));
  },

  findById(id) {
    return withRetry(() => prisma.user.findUnique({ where: { id } }));
  },

  create(data) {
    return withRetry(() => prisma.user.create({ data }));
  },
};

module.exports = userRepository;
