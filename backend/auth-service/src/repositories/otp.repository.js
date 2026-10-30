const prisma = require("../config/database");
const { withRetry } = require("../utils/withRetry");

const otpRepository = {
  create(data) {
    return withRetry(() => prisma.otpCode.create({ data }));
  },

  createReplacingActive(data) {
    return withRetry(() =>
      prisma.$transaction(async (tx) => {
        await tx.otpCode.updateMany({
          where: {
            email: data.email,
            purpose: data.purpose,
            consumedAt: null,
          },
          data: { consumedAt: new Date() },
        });
        return tx.otpCode.create({ data });
      })
    );
  },

  findLatestActive(email, purpose) {
    return withRetry(() =>
      prisma.otpCode.findFirst({
        where: {
          email,
          purpose,
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "desc" },
      })
    );
  },

  incrementAttempts(id) {
    return withRetry(() =>
      prisma.otpCode.update({
        where: { id },
        data: { attempts: { increment: 1 } },
        select: { id: true, attempts: true },
      })
    );
  },

  consumeIfActive(id) {
    return withRetry(() =>
      prisma.otpCode.updateMany({
        where: { id, consumedAt: null },
        data: { consumedAt: new Date() },
      })
    );
  },
};

module.exports = otpRepository;
