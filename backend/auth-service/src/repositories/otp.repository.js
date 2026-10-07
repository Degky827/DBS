const prisma = require("../config/database");
const { withRetry } = require("../utils/withRetry");

const otpRepository = {
  create(data) {
    return withRetry(() => prisma.otpCode.create({ data }));
  },

  findLatestActive(email, purpose) {
    return withRetry(() =>
      prisma.otpCode.findFirst({
        where: { email, purpose, consumedAt: null },
        orderBy: { createdAt: "desc" },
      })
    );
  },

  consume(id) {
    return withRetry(() =>
      prisma.otpCode.update({ where: { id }, data: { consumedAt: new Date() } })
    );
  },
};

module.exports = otpRepository;
