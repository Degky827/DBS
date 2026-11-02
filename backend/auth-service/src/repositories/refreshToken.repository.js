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

  // A family is live while at least one token in it is neither revoked nor
  // past either expiry. Used to validate the access token's sid claim.
  findActiveInFamily(familyId, now = new Date()) {
    return withRetry(() =>
      prisma.refreshToken.findFirst({
        where: {
          familyId,
          revokedAt: null,
          expiresAt: { gt: now },
          OR: [{ familyExpiresAt: null }, { familyExpiresAt: { gt: now } }],
        },
        select: { id: true, userId: true, familyExpiresAt: true },
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
