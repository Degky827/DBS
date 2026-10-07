const prisma = require("../config/database");
const { withRetry } = require("../utils/withRetry");

const refreshTokenRepository = {
  create(data) {
    return withRetry(() => prisma.refreshToken.create({ data }));
  },

  findActiveByHash(tokenHash) {
    return withRetry(() =>
      prisma.refreshToken.findFirst({
        where: { tokenHash, revokedAt: null },
        include: { user: true },
      })
    );
  },

  revoke(id) {
    return withRetry(() =>
      prisma.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } })
    );
  },

  revokeAllForUser(userId) {
    return withRetry(() =>
      prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
    );
  },
};

module.exports = refreshTokenRepository;
