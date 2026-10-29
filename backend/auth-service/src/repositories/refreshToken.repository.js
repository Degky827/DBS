const prisma = require("../config/database");
const { withRetry } = require("../utils/withRetry");

const refreshTokenRepository = {
  create(data) {
    return withRetry(() => prisma.refreshToken.create({ data }));
  },

  findByHash(tokenHash) {
    return withRetry(() =>
      prisma.refreshToken.findUnique({
        where: { tokenHash },
        include: { user: true },
      })
    );
  },

  revokeFamily(familyId) {
    return withRetry(() =>
      prisma.refreshToken.updateMany({
        where: { familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
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
