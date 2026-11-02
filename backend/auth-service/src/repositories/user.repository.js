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

  // Rejects every access token issued before this call. Combined with refresh
  // token revocation this terminates all existing sessions.
  invalidateSessions(id, at = new Date()) {
    return withRetry(() =>
      prisma.user.update({
        where: { id },
        data: { tokenValidAfter: at },
      })
    );
  },

  updateNotificationPreferences(id, preferences) {
    return withRetry(() =>
      prisma.user.update({ where: { id }, data: preferences })
    );
  },

  update(id, data) {
    return withRetry(() => prisma.user.update({ where: { id }, data }));
  },

  findManyByEmails(emails) {
    return withRetry(() =>
      prisma.user.findMany({
        where: { email: { in: emails } },
        select: {
          id: true,
          email: true,
          status: true,
          statusReason: true,
          statusChangedAt: true,
          mfaEnabled: true,
        },
      })
    );
  },

  create(data) {
    return withRetry(() => prisma.user.create({ data }));
  },
};

module.exports = userRepository;
