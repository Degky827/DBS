// Tier-aware code paths read KycTierDefinition, KycTierAssignment and
// KycOutboxEvent. Unit suites that stub the database keep their own submission
// fixtures, so this shared fragment answers "no tier policy configured yet" -
// the same answer a fresh deployment gives before an administrator writes one -
// and a suite can overwrite any function when it wants tier rows to exist.
const tierPrismaStub = () => ({
  kycTierDefinition: {
    findMany: async () => [],
    findFirst: async () => null,
    findUnique: async () => null,
  },
  kycTierAssignment: {
    findFirst: async () => null,
    findMany: async () => [],
    findUnique: async () => null,
    updateMany: async () => ({ count: 0 }),
    create: async ({ data }) => ({ id: "tier-assignment-stub", ...data }),
  },
  kycReVerificationTask: {
    updateMany: async () => ({ count: 0 }),
  },
  kycOutboxEvent: {
    create: async ({ data }) => ({ id: "outbox-event-stub", ...data }),
    count: async () => 0,
  },
});

module.exports = { tierPrismaStub };
