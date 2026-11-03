const prisma = require("../config/database");
const env = require("../config/env");
const ApiError = require("../utils/ApiError");
const metrics = require("../utils/metrics");
const { evaluateApproval } = require("../utils/approval");
const {
  ASSIGNMENT_DIRECTION,
  ASSIGNMENT_STATUS,
  VERIFIABLE_FIELDS,
  tierRank,
} = require("../constants/kycTier");

const DAY_MS = 24 * 60 * 60 * 1000;

const asArray = (value) => (Array.isArray(value) ? value : []);

// Prisma returns DECIMAL(19,2) columns as exact decimal objects. They are
// handed on as strings so no consumer (user-service clamping, the SPA, a
// rendered report) ever has to trust a float round-trip.
const decimal = (value) => (value === null || value === undefined ? null : String(value));

const serializeLimit = (limit) => ({
  operation: limit.operation,
  currency: limit.currency,
  minAmount: decimal(limit.minAmount),
  maxAmount: decimal(limit.maxAmount),
  dailyAmount: decimal(limit.dailyAmount),
  dailyCount: limit.dailyCount,
  monthlyAmount: decimal(limit.monthlyAmount),
  maxBalance: decimal(limit.maxBalance),
  isAllowed: limit.isAllowed,
});

const serializeTier = (tier) => ({
  id: tier.id,
  code: tier.code,
  name: tier.name,
  description: tier.description,
  minimumDocuments: tier.minimumDocuments,
  requiresLiveness: tier.requiresLiveness,
  requiredFields: asArray(tier.requiredFields),
  requiredDocumentTypes: asArray(tier.requiredDocumentTypes),
  allowedOperations: asArray(tier.allowedOperations),
  reviewIntervalDays: tier.reviewIntervalDays,
  approvalValidDays: tier.approvalValidDays,
  reVerificationLeadDays: tier.reVerificationLeadDays,
  version: tier.version,
  isActive: tier.isActive,
  effectiveFrom: tier.effectiveFrom,
  limits: asArray(tier.limits).map(serializeLimit),
});

const definitionInclude = { limits: true };

const findActiveDefinitions = () =>
  prisma.kycTierDefinition.findMany({
    where: { isActive: true },
    include: definitionInclude,
  });

const listDefinitions = async ({ includeInactive = false } = {}) => {
  const rows = await prisma.kycTierDefinition.findMany({
    where: includeInactive ? {} : { isActive: true },
    include: definitionInclude,
  });
  return rows
    .map((row) => serializeTier(row))
    .sort(
      (a, b) =>
        tierRank(a.code) - tierRank(b.code) || a.version - b.version || a.code.localeCompare(b.code)
    );
};

const getDefinitionByCode = async (code, { activeOnly = true } = {}) => {
  const rows = await prisma.kycTierDefinition.findMany({
    where: { code, ...(activeOnly ? { isActive: true } : {}) },
    include: definitionInclude,
    orderBy: { version: "desc" },
  });
  return rows[0] || null;
};

const getDefinitionById = async (tierId, { activeOnly = true } = {}) => {
  const row = await prisma.kycTierDefinition.findUnique({
    where: { id: tierId },
    include: definitionInclude,
  });
  if (!row) return null;
  if (activeOnly && !row.isActive) return null;
  return row;
};

// ---------------------------------------------------------------------------
// Qualification
// ---------------------------------------------------------------------------
// The evidence a submission actually holds. Nothing here is inferred: a field
// counts as verified only when the profile comparison recorded MATCH for it.
const loadEvidence = async (submissionId) => {
  const submission = await prisma.kycSubmission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      userId: true,
      status: true,
      livenessStatus: true,
      comparisonResults: true,
      documents: { select: { documentType: true } },
    },
  });
  if (!submission) {
    throw ApiError.notFound("KYC submission not found", "KYC_SUBMISSION_NOT_FOUND");
  }

  return {
    submissionId: submission.id,
    userId: submission.userId,
    status: submission.status,
    livenessStatus: submission.livenessStatus,
    documentCount: submission.documents.length,
    documentTypes: new Set(submission.documents.map((doc) => doc.documentType)),
    verifiedFields: new Set(
      asArray(submission.comparisonResults)
        .filter((row) => row && row.status === "MATCH")
        .map((row) => row.field)
    ),
  };
};

const evaluateQualification = (tier, evidence) => {
  // Hard blockers are evidence the platform holds and finds missing, so no
  // officer decision can make them true. Attestations are requirements the
  // service cannot check at all; they are reported, never assumed satisfied.
  const blockers = [];
  const attestations = [];

  if (evidence.documentCount < tier.minimumDocuments) {
    blockers.push({
      code: "INSUFFICIENT_DOCUMENTS",
      detail: `${tier.minimumDocuments} document capture(s) required, ${evidence.documentCount} on file`,
    });
  }

  for (const required of asArray(tier.requiredDocumentTypes)) {
    if (!evidence.documentTypes.has(required)) {
      blockers.push({
        code: "MISSING_DOCUMENT_TYPE",
        detail: `no ${required} document in this submission`,
      });
    }
  }

  if (tier.requiresLiveness && evidence.livenessStatus !== "Approved") {
    blockers.push({
      code: "LIVENESS_NOT_APPROVED",
      detail: `liveness status is ${evidence.livenessStatus || "unknown"}`,
    });
  }

  for (const field of asArray(tier.requiredFields)) {
    if (!VERIFIABLE_FIELDS.includes(field)) {
      attestations.push(field);
      continue;
    }
    if (!evidence.verifiedFields.has(field)) {
      blockers.push({
        code: "PROFILE_FIELD_NOT_MATCHED",
        detail: `${field} has no matching identity-document value`,
      });
    }
  }

  return {
    qualifies: blockers.length === 0 && attestations.length === 0,
    qualifiesWithAttestation: blockers.length === 0 && attestations.length > 0,
    blockers,
    unverifiedFields: attestations,
  };
};

const heldAssignmentSelect = {
  id: true,
  userId: true,
  tierId: true,
  direction: true,
  status: true,
  submissionId: true,
  requestedBy: true,
  decidedBy: true,
  reason: true,
  decisionReason: true,
  requestedAt: true,
  decidedAt: true,
  effectiveUntil: true,
  expiresAt: true,
};

// The tier an assignment holds carries its own limit rows, so the policy is read
// through the relation rather than copied onto the assignment.
const assignmentInclude = { tier: { include: definitionInclude } };

const findHeldAssignment = (userId) =>
  prisma.kycTierAssignment.findFirst({
    where: { userId, status: ASSIGNMENT_STATUS.APPROVED },
    orderBy: [{ decidedAt: "desc" }, { createdAt: "desc" }],
    include: assignmentInclude,
  });

const qualificationFor = async (submissionId) => {
  const [evidence, definitions, held] = await Promise.all([
    loadEvidence(submissionId),
    findActiveDefinitions(),
    // The held tier is read here so an officer can see the change a decision
    // would make; it is not used to decide eligibility.
    prisma.kycSubmission
      .findUnique({ where: { id: submissionId }, select: { userId: true } })
      .then((row) => (row ? findHeldAssignment(row.userId) : null)),
  ]);

  const candidates = definitions
    .map((tier) => ({ ...serializeTier(tier), evaluation: evaluateQualification(tier, evidence) }))
    .sort((a, b) => tierRank(b.code) - tierRank(a.code));

  const qualifying = candidates.filter((row) => row.evaluation.qualifies);
  const suggested = qualifying.length ? qualifying[0] : null;

  return {
    submissionId: evidence.submissionId,
    userId: evidence.userId,
    submissionStatus: evidence.status,
    evidence: {
      documentCount: evidence.documentCount,
      documentTypes: [...evidence.documentTypes],
      livenessStatus: evidence.livenessStatus,
      verifiedFields: [...evidence.verifiedFields],
    },
    current: held ? serializeTier(held.tier) : null,
    suggested: suggested
      ? {
          tierId: suggested.id,
          code: suggested.code,
          name: suggested.name,
          approvalValidDays: suggested.approvalValidDays,
        }
      : null,
    candidates: candidates.map((row) => ({
      tierId: row.id,
      code: row.code,
      name: row.name,
      qualifies: row.evaluation.qualifies,
      qualifiesWithAttestation: row.evaluation.qualifiesWithAttestation,
      blockers: row.evaluation.blockers,
      unverifiedFields: row.evaluation.unverifiedFields,
    })),
  };
};

// ---------------------------------------------------------------------------
// Held tier and limits
// ---------------------------------------------------------------------------
const approvalExpiresAtFor = (tier, from) => {
  const days = tier?.approvalValidDays ?? env.KYC_APPROVAL_TTL_DAYS;
  return new Date(from.getTime() + days * DAY_MS);
};

const isUsable = (assignment, now) =>
  assignment &&
  assignment.tier?.isActive &&
  (!assignment.expiresAt || assignment.expiresAt.getTime() > now.getTime());

// The tier a customer's money is allowed to move through. A granted assignment
// is authoritative; a pre-Phase-4 approval with no assignment row falls back to
// the lowest active tier rather than to unlimited, because the platform has not
// seen the evidence a higher tier asks for.
const effectiveTier = async (userId, { now = new Date() } = {}) => {
  const [latestSubmission, held] = await Promise.all([
    prisma.kycSubmission.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        approvalExpiresAt: true,
        revokedAt: true,
        tierId: true,
      },
    }),
    findHeldAssignment(userId),
  ]);

  const approval = evaluateApproval(latestSubmission, now);
  if (!approval.isApproved) {
    return {
      userId,
      isApproved: false,
      effectiveStatus: approval.effectiveStatus,
      tier: null,
      limits: [],
      allowedOperations: [],
      source: null,
      requiresReVerification: true,
    };
  }

  if (isUsable(held, now)) {
    const tier = serializeTier(held.tier);
    return {
      userId,
      isApproved: true,
      effectiveStatus: approval.effectiveStatus,
      tier,
      limits: tier.limits,
      allowedOperations: asArray(held.tier.allowedOperations),
      source: "ASSIGNMENT",
      assignmentId: held.id,
      expiresAt: held.expiresAt,
      reviewIntervalDays: held.tier.reviewIntervalDays,
      requiresReVerification: false,
    };
  }

  const [definitions, submissionTier] = await Promise.all([
    findActiveDefinitions(),
    latestSubmission.tierId ? getDefinitionById(latestSubmission.tierId) : null,
  ]);

  if (submissionTier) {
    return {
      userId,
      isApproved: true,
      effectiveStatus: approval.effectiveStatus,
      tier: serializeTier(submissionTier),
      limits: asArray(submissionTier.limits).map(serializeLimit),
      allowedOperations: asArray(submissionTier.allowedOperations),
      source: "SUBMISSION",
      expiresAt: latestSubmission.approvalExpiresAt,
      reviewIntervalDays: submissionTier.reviewIntervalDays,
      requiresReVerification: false,
    };
  }

  const lowest = definitions
    .map((tier) => serializeTier(tier))
    .sort((a, b) => tierRank(a.code) - tierRank(b.code) || a.version - b.version)[0];

  if (!lowest) {
    // No active tier definition is configured. The caller must treat this as
    // "no tier policy", not as an unlimited one: platform policy alone applies.
    return {
      userId,
      isApproved: true,
      effectiveStatus: approval.effectiveStatus,
      tier: null,
      limits: [],
      allowedOperations: [],
      source: "NOT_CONFIGURED",
      expiresAt: latestSubmission.approvalExpiresAt,
      requiresReVerification: false,
    };
  }

  return {
    userId,
    isApproved: true,
    effectiveStatus: approval.effectiveStatus,
    tier: lowest,
    limits: lowest.limits,
    allowedOperations: lowest.allowedOperations,
    source: "FALLBACK",
    expiresAt: latestSubmission.approvalExpiresAt,
    reviewIntervalDays: lowest.reviewIntervalDays,
    requiresReVerification: false,
  };
};

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------
const directionFor = (previous, next) => {
  if (!previous) return ASSIGNMENT_DIRECTION.INITIAL;
  const delta = tierRank(next.code) - tierRank(previous.tier.code);
  if (delta > 0) return ASSIGNMENT_DIRECTION.UPGRADE;
  if (delta < 0) return ASSIGNMENT_DIRECTION.DOWNGRADE;
  return ASSIGNMENT_DIRECTION.MAINTENANCE;
};

// Must run inside the transaction that records the approval: the tier a
// customer holds and the decision that granted it commit together or not at
// all. Returns the assignment row plus the tier, so the caller can derive the
// approval expiry from the same value it persisted.
const assignOnApproval = async (
  tx,
  {
    submissionId,
    userId,
    tier,
    previous,
    actorId,
    expiresAt,
    reason,
    decisionReason,
    promoteAssignmentId,
  }
) => {
  const now = new Date();
  if (previous) {
    // The retired row stops covering the customer at the moment the new grant
    // takes effect, not at the new grant's expiry, otherwise two rows would each
    // claim the same period.
    await tx.kycTierAssignment.updateMany({
      where: { id: previous.id, status: ASSIGNMENT_STATUS.APPROVED },
      data: {
        status: ASSIGNMENT_STATUS.SUPERSEDED,
        decidedBy: actorId,
        decidedAt: now,
        effectiveUntil: now,
        decisionReason: "Superseded by a later approved KYC decision",
      },
    });
  }

  const direction = directionFor(previous, tier);

  const grant = {
    userId,
    tierId: tier.id,
    direction,
    status: ASSIGNMENT_STATUS.APPROVED,
    submissionId,
    decidedBy: actorId,
    decidedAt: now,
    reason,
    decisionReason,
    effectiveUntil: expiresAt,
    expiresAt,
  };

  let assignment;
  if (promoteAssignmentId) {
    // A granted request keeps its own row: the customer's ask and the officer's
    // grant are one history entry, and exactly one APPROVED row is left.
    const promoted = await tx.kycTierAssignment.updateMany({
      where: { id: promoteAssignmentId, status: ASSIGNMENT_STATUS.REQUESTED },
      data: grant,
    });
    if (promoted.count !== 1) {
      throw ApiError.conflict("Tier request is already decided", "TIER_REQUEST_DECIDED");
    }
    assignment = await tx.kycTierAssignment.findUnique({
      where: { id: promoteAssignmentId },
      select: heldAssignmentSelect,
    });
  } else {
    assignment = await tx.kycTierAssignment.create({
      data: { ...grant, requestedBy: actorId },
      select: heldAssignmentSelect,
    });
  }

  await tx.kycSubmission.update({
    where: { id: submissionId },
    data: { tierId: tier.id, tierAssignedAt: now, tierAssignedBy: actorId },
  });

  await tx.kycAuditEvent.create({
    data: {
      submissionId,
      eventType: "TIER_ASSIGNED",
      actorId,
      payload: {
        tierId: tier.id,
        tierCode: tier.code,
        tierVersion: tier.version,
        direction,
        unverifiedFields: asArray(tier.requiredFields).filter(
          (field) => !VERIFIABLE_FIELDS.includes(field)
        ),
      },
    },
  });

  metrics.recordTierAssignment(direction, "assigned");
  return { assignment, direction };
};

const cancelHeldAssignment = async (tx, { userId, actorId, reason, at }) => {
  // The grant ends with the approval, but the row stays as history: an officer
  // must be able to show which tier a customer held when a transaction ran.
  const cancelled = await tx.kycTierAssignment.updateMany({
    where: { userId, status: ASSIGNMENT_STATUS.APPROVED },
    data: {
      status: ASSIGNMENT_STATUS.CANCELLED,
      decidedBy: actorId,
      decidedAt: at,
      effectiveUntil: at,
      decisionReason: reason,
    },
  });
  return cancelled.count;
};

// ---------------------------------------------------------------------------
// Customer requests and officer decisions
// ---------------------------------------------------------------------------
const requestTierChange = async ({ userId, tierCode, reason }) => {
  const tier = await getDefinitionByCode(tierCode);
  if (!tier) {
    throw ApiError.badRequest("Tier is not available", "TIER_NOT_FOUND");
  }

  const existing = await prisma.kycTierAssignment.findFirst({
    where: { userId, status: ASSIGNMENT_STATUS.REQUESTED },
    select: { id: true, tierId: true },
  });
  if (existing) {
    throw ApiError.conflict(
      "A tier request is already awaiting review",
      "TIER_REQUEST_ALREADY_OPEN"
    );
  }

  const held = await findHeldAssignment(userId);
  if (held && held.tierId === tier.id) {
    throw ApiError.conflict("This tier is already granted", "TIER_ALREADY_GRANTED");
  }

  // A tier request is a change to the limits a verified customer already lives
  // under. Someone who is not approved has no limits to move, so the KYC review
  // - not a tier request - is their route into a tier.
  const submission = await prisma.kycSubmission.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      approvalExpiresAt: true,
      revokedAt: true,
    },
  });
  if (!submission) {
    throw ApiError.conflict(
      "Submit a KYC application before requesting a tier",
      "KYC_SUBMISSION_NOT_FOUND"
    );
  }
  if (!evaluateApproval(submission).isApproved) {
    throw ApiError.conflict(
      "A tier request needs a currently approved KYC status",
      "KYC_NOT_APPROVED"
    );
  }

  const evidence = await loadEvidence(submission.id);
  const evaluation = evaluateQualification(tier, evidence);
  const created = await prisma.kycTierAssignment.create({
    data: {
      userId,
      tierId: tier.id,
      direction: directionFor(held, tier),
      status: ASSIGNMENT_STATUS.REQUESTED,
      submissionId: submission.id,
      requestedBy: userId,
      reason,
    },
    select: heldAssignmentSelect,
  });

  await prisma.kycAuditEvent.create({
    data: {
      submissionId: submission.id,
      eventType: "TIER_REQUESTED",
      actorId: userId,
      payload: {
        tierId: tier.id,
        tierCode: tier.code,
        blockers: evaluation.blockers,
        unverifiedFields: evaluation.unverifiedFields,
      },
    },
  });

  metrics.recordTierAssignment(created.direction, "requested");

  return {
    request: created,
    tier: serializeTier(tier),
    evaluation,
  };
};

const listRequests = async ({ status = ASSIGNMENT_STATUS.REQUESTED, limit = 50 } = {}) => {
  const rows = await prisma.kycTierAssignment.findMany({
    where: { status },
    orderBy: { requestedAt: "asc" },
    take: limit,
    select: { ...heldAssignmentSelect, tier: { include: definitionInclude } },
  });
  return rows.map((assignment) => ({
    ...assignment,
    tier: serializeTier(assignment.tier),
  }));
};

const decideRequest = async ({ assignmentId, actorId, decision, decisionReason }) => {
  const request = await prisma.kycTierAssignment.findUnique({
    where: { id: assignmentId },
    select: { ...heldAssignmentSelect, tier: { include: definitionInclude } },
  });
  if (!request) {
    throw ApiError.notFound("Tier request not found", "TIER_REQUEST_NOT_FOUND");
  }
  if (request.status !== ASSIGNMENT_STATUS.REQUESTED) {
    throw ApiError.conflict("Tier request is already decided", "TIER_REQUEST_DECIDED");
  }
  if (request.userId === actorId) {
    throw ApiError.forbidden("You cannot decide your own tier request", "SELF_REVIEW_FORBIDDEN");
  }

  const decidedAt = new Date();

  if (decision === "REJECT") {
    const rejected = await prisma.kycTierAssignment.updateMany({
      where: { id: assignmentId, status: ASSIGNMENT_STATUS.REQUESTED },
      data: {
        status: ASSIGNMENT_STATUS.REJECTED,
        decidedBy: actorId,
        decidedAt,
        decisionReason,
      },
    });
    if (rejected.count !== 1) {
      throw ApiError.conflict("Tier request is already decided", "TIER_REQUEST_DECIDED");
    }
    await prisma.kycAuditEvent.create({
      data: {
        submissionId: request.submissionId,
        eventType: "TIER_REQUEST_REJECTED",
        actorId,
        payload: { assignmentId, tierCode: request.tier.code, decisionReason },
      },
    });
    metrics.recordTierAssignment(request.direction, "rejected");
    const decided = await prisma.kycTierAssignment.findUnique({
      where: { id: assignmentId },
      select: heldAssignmentSelect,
    });
    return { ...decided, tier: serializeTier(request.tier) };
  }

  const held = await findHeldAssignment(request.userId);

  if (held && held.tierId === request.tierId && isUsable(held, decidedAt)) {
    throw ApiError.conflict("This tier is already granted", "TIER_ALREADY_GRANTED");
  }

  // Granting a request still has to clear the evidence the platform can check.
  // An officer may approve a tier whose only unmet requirements are fields
  // kyc-service cannot verify - that is the attestation - but not one that is
  // short of documents or liveness.
  if (!request.submissionId) {
    throw ApiError.conflict(
      "The submission behind this request is no longer available",
      "KYC_SUBMISSION_NOT_FOUND"
    );
  }
  const evidence = await loadEvidence(request.submissionId);
  const evaluation = evaluateQualification(request.tier, evidence);
  if (evaluation.blockers.length > 0) {
    throw ApiError.conflict(
      "The stored evidence does not support this tier",
      "TIER_EVIDENCE_INSUFFICIENT",
      { blockers: evaluation.blockers }
    );
  }

  // The approval can have expired, or been revoked, while the request waited.
  // Granting a tier on top of a dead approval would hand out limits the
  // customer cannot use and cannot be traced back to live evidence.
  const approvalRow = await prisma.kycSubmission.findUnique({
    where: { id: request.submissionId },
    select: { status: true, approvalExpiresAt: true, revokedAt: true },
  });
  if (!evaluateApproval(approvalRow, decidedAt).isApproved) {
    throw ApiError.conflict(
      "The KYC approval behind this request is no longer active",
      "KYC_APPROVAL_NOT_ACTIVE"
    );
  }

  const expiresAt = approvalExpiresAtFor(request.tier, decidedAt);

  return prisma.$transaction(async (tx) => {
    const { assignment, direction } = await assignOnApproval(tx, {
      submissionId: request.submissionId,
      userId: request.userId,
      tier: request.tier,
      previous: held,
      actorId,
      expiresAt,
      reason: request.reason,
      decisionReason,
      promoteAssignmentId: assignmentId,
    });

    return {
      ...assignment,
      direction,
      tier: serializeTier(request.tier),
      expiresAt,
      evaluation,
    };
  });
};

// ---------------------------------------------------------------------------
// Tier definition administration (ADMIN)
// ---------------------------------------------------------------------------
const createTierVersion = async ({
  code,
  name,
  description,
  minimumDocuments,
  requiresLiveness,
  requiredFields,
  requiredDocumentTypes,
  allowedOperations,
  reviewIntervalDays,
  approvalValidDays,
  reVerificationLeadDays,
  limits = [],
  actorId,
}) => {
  // `code` is not unique on its own (versions share it), so the newest version
  // is found by ordering instead.
  const latest = await prisma.kycTierDefinition.findFirst({
    where: { code },
    orderBy: { version: "desc" },
    select: {
      id: true,
      description: true,
      reviewIntervalDays: true,
      approvalValidDays: true,
      reVerificationLeadDays: true,
      version: true,
    },
  });

  const created = await prisma.kycTierDefinition.create({
    data: {
      code,
      name,
      description: description ?? latest?.description ?? null,
      minimumDocuments,
      requiresLiveness,
      requiredFields,
      requiredDocumentTypes,
      allowedOperations,
      reviewIntervalDays: reviewIntervalDays ?? latest?.reviewIntervalDays ?? null,
      approvalValidDays: approvalValidDays ?? latest?.approvalValidDays ?? null,
      reVerificationLeadDays: reVerificationLeadDays ?? latest?.reVerificationLeadDays ?? 30,
      version: (latest?.version ?? 0) + 1,
      // A new version starts inactive: activating it is a separate, audited
      // step so an unfinished policy can never reach a live transaction.
      isActive: false,
      // Limit rows ride along when the administrator supplied them. A version
      // without any cannot be activated, which is what keeps a half-written
      // policy out of the transaction path.
      ...(limits.length
        ? {
            limits: {
              create: limits.map((row) => ({
                operation: row.operation,
                currency: row.currency,
                minAmount: row.minAmount,
                maxAmount: row.maxAmount ?? null,
                dailyAmount: row.dailyAmount ?? null,
                dailyCount: row.dailyCount ?? null,
                monthlyAmount: row.monthlyAmount ?? null,
                maxBalance: row.maxBalance ?? null,
                isAllowed: row.isAllowed ?? true,
              })),
            },
          }
        : {}),
    },
    include: definitionInclude,
  });

  await prisma.kycAuditEvent.create({
    data: {
      eventType: "TIER_DEFINITION_VERSION_CREATED",
      actorId,
      payload: {
        tierId: created.id,
        code: created.code,
        version: created.version,
        supersedes: latest?.id ?? null,
      },
    },
  });

  return serializeTier(created);
};

const setDefinitionActive = async ({ tierId, actorId }) => {
  const target = await prisma.kycTierDefinition.findUnique({
    where: { id: tierId },
    include: definitionInclude,
  });
  if (!target) {
    throw ApiError.notFound("Tier definition not found", "TIER_NOT_FOUND");
  }
  if (target.limits.length === 0) {
    throw ApiError.conflict(
      "A tier needs at least one limit row before it can be activated",
      "TIER_LIMITS_MISSING"
    );
  }

  return prisma.$transaction(async (tx) => {
    // One live row per code is enforced by a partial unique index, so the old
    // version is retired inside the same transaction that promotes the new one.
    await tx.kycTierDefinition.updateMany({
      where: { code: target.code, isActive: true },
      data: { isActive: false },
    });
    const updated = await tx.kycTierDefinition.update({
      where: { id: target.id },
      data: { isActive: true, effectiveFrom: new Date() },
      include: definitionInclude,
    });
    await tx.kycAuditEvent.create({
      data: {
        eventType: "TIER_DEFINITION_ACTIVATED",
        actorId,
        payload: { tierId: updated.id, code: updated.code, version: updated.version },
      },
    });
    return serializeTier(updated);
  });
};

const retireDefinition = async ({ tierId, actorId }) => {
  const target = await prisma.kycTierDefinition.findUnique({
    where: { id: tierId },
    select: { id: true, code: true, version: true },
  });
  if (!target) {
    throw ApiError.notFound("Tier definition not found", "TIER_NOT_FOUND");
  }
  const holders = await prisma.kycTierAssignment.count({
    where: { tierId, status: ASSIGNMENT_STATUS.APPROVED },
  });
  if (holders > 0) {
    throw ApiError.conflict(
      `${holders} customer(s) still hold this tier; move them first`,
      "TIER_IN_USE"
    );
  }

  await prisma.kycTierDefinition.update({
    where: { id: tierId },
    data: { isActive: false },
  });
  await prisma.kycAuditEvent.create({
    data: {
      eventType: "TIER_DEFINITION_RETIRED",
      actorId,
      payload: { tierId, code: target.code, version: target.version },
    },
  });
  return { tierId, code: target.code, version: target.version, isActive: false };
};

const updateTierLimits = async ({ tierId, limits, actorId }) => {
  const target = await prisma.kycTierDefinition.findUnique({
    where: { id: tierId },
    select: { id: true, code: true, version: true, isActive: true },
  });
  if (!target) {
    throw ApiError.notFound("Tier definition not found", "TIER_NOT_FOUND");
  }

  const operations = new Set(limits.map((row) => row.operation));
  if (operations.size !== limits.length) {
    throw ApiError.badRequest("One limit row per operation is allowed", "DUPLICATE_TIER_LIMIT");
  }

  return prisma.$transaction(async (tx) => {
    for (const row of limits) {
      // Amounts are sent as strings and written straight to DECIMAL(19,2);
      // Prisma keeps them exact without a float passing through the value.
      await tx.kycTierLimit.upsert({
        where: {
          tierId_operation_currency: {
            tierId,
            operation: row.operation,
            currency: row.currency,
          },
        },
        create: { tierId, ...row },
        update: {
          minAmount: row.minAmount,
          maxAmount: row.maxAmount,
          dailyAmount: row.dailyAmount,
          dailyCount: row.dailyCount,
          monthlyAmount: row.monthlyAmount,
          maxBalance: row.maxBalance,
          isAllowed: row.isAllowed,
        },
      });
    }
    await tx.kycAuditEvent.create({
      data: {
        eventType: "TIER_LIMITS_UPDATED",
        actorId,
        payload: {
          tierId,
          code: target.code,
          version: target.version,
          isActive: target.isActive,
          operations: limits.map((row) => row.operation),
        },
      },
    });
    const refreshed = await tx.kycTierDefinition.findUnique({
      where: { id: tierId },
      include: definitionInclude,
    });
    return serializeTier(refreshed);
  });
};

const assignmentHistory = async (userId, { limit = 50 } = {}) => {
  const rows = await prisma.kycTierAssignment.findMany({
    where: { userId },
    orderBy: { requestedAt: "desc" },
    take: limit,
    select: {
      ...heldAssignmentSelect,
      tier: { select: { id: true, code: true, name: true, version: true } },
    },
  });
  return rows;
};

const tierSummary = async () => {
  const [rows, definitions] = await Promise.all([
    prisma.kycTierAssignment.groupBy({
      by: ["tierId"],
      where: { status: ASSIGNMENT_STATUS.APPROVED },
      _count: { _all: true },
    }),
    findActiveDefinitions(),
  ]);
  const holders = new Map(rows.map((row) => [row.tierId, row._count._all]));
  const live = definitions.map((tier) => ({
    tierId: tier.id,
    code: tier.code,
    name: tier.name,
    version: tier.version,
    holders: holders.get(tier.id) || 0,
  }));
  const retired = rows
    .filter((row) => !definitions.some((tier) => tier.id === row.tierId))
    .map((row) => ({
      tierId: row.tierId,
      code: null,
      name: "Inactive tier definition",
      version: null,
      holders: row._count._all,
    }));
  return [...live, ...retired];
};

module.exports = {
  DAY_MS,
  asArray,
  decimal,
  serializeTier,
  serializeLimit,
  findActiveDefinitions,
  listDefinitions,
  getDefinitionByCode,
  getDefinitionById,
  loadEvidence,
  evaluateQualification,
  qualificationFor,
  approvalExpiresAtFor,
  findHeldAssignment,
  effectiveTier,
  assignOnApproval,
  cancelHeldAssignment,
  requestTierChange,
  listRequests,
  decideRequest,
  createTierVersion,
  setDefinitionActive,
  retireDefinition,
  updateTierLimits,
  assignmentHistory,
  tierSummary,
};
