const prisma = require("../config/database");
const { withRetry } = require("../utils/withRetry");

const accessTokenRevocationRepository = {
  isRevoked(jti) {
    return withRetry(() =>
      prisma.accessTokenRevocation.findUnique({
        where: { jti },
        select: { id: true },
      })
    );
  },

  revoke({ jti, userId, reason, expiresAt }) {
    return withRetry(() =>
      prisma.accessTokenRevocation.upsert({
        where: { jti },
        create: { jti, userId, reason, expiresAt },
        update: {},
      })
    );
  },

  deleteExpired(now = new Date()) {
    return withRetry(() =>
      prisma.accessTokenRevocation.deleteMany({
        where: { expiresAt: { lt: now } },
      })
    );
  },
};

module.exports = accessTokenRevocationRepository;
