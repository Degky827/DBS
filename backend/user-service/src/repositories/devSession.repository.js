const prisma = require("../config/database");
const { withRetry } = require("../utils/withRetry");

const devSessionRepository = {
  create(data) {
    return withRetry(() => prisma.devSession.create({ data }));
  },

  findActiveByHash(tokenHash) {
    return withRetry(() =>
      prisma.devSession.findFirst({
        where: { tokenHash, revokedAt: null },
        include: { user: true },
      })
    );
  },

  revoke(id) {
    return withRetry(() =>
      prisma.devSession.update({
        where: { id },
        data: { revokedAt: new Date() },
      })
    );
  },

  revokeAllForUser(userId) {
    return withRetry(() =>
      prisma.devSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
    );
  },

  revokeAllForUserExcept(userId, keepSessionId) {
    return withRetry(() =>
      prisma.devSession.updateMany({
        where: {
          userId,
          revokedAt: null,
          id: { not: keepSessionId },
        },
        data: { revokedAt: new Date() },
      })
    );
  },
};

module.exports = devSessionRepository;
