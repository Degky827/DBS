const prisma = require("../config/database");
const ApiError = require("../utils/ApiError");
const userServiceClient = require("./userServiceClient");
const tierService = require("./tierService");
const { SUBMISSION_STATUS } = require("../constants/kycStatus");
const { evaluateApproval } = require("../utils/approval");

async function createSubmission(userId, authorization) {
  await userServiceClient.getMyProfile(authorization);

  return prisma.$transaction(async (tx) => {
    const latest = await tx.kycSubmission.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        approvedAt: true,
        approvalExpiresAt: true,
        revokedAt: true,
      },
    });

    if (latest) {
      // Retrying submission creation for an editable application returns the
      // existing one instead of creating a parallel draft with its own
      // provider session.
      if (
        latest.status === SUBMISSION_STATUS.DRAFT ||
        latest.status === SUBMISSION_STATUS.NEEDS_RESUBMISSION
      ) {
        return { ...latest, reused: true };
      }

      if (latest.status === SUBMISSION_STATUS.APPROVED) {
        const { isApproved } = evaluateApproval(latest);
        if (isApproved) {
          throw ApiError.conflict(
            "KYC is already approved for this account",
            "KYC_ALREADY_APPROVED"
          );
        }
        // An expired or revoked approval may be replaced by a new application.
      } else if (
        latest.status === SUBMISSION_STATUS.IN_PROGRESS ||
        latest.status === SUBMISSION_STATUS.PENDING_REVIEW
      ) {
        throw ApiError.conflict(
          "A KYC application is already in progress",
          "KYC_APPLICATION_IN_PROGRESS"
        );
      }
    }

    const submission = await tx.kycSubmission.create({
      data: { userId },
      select: {
        id: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await tx.kycAuditEvent.create({
      data: {
        submissionId: submission.id,
        eventType: "SUBMISSION_CREATED",
        actorId: userId,
      },
    });

    return submission;
  });
}

async function getCurrentStatus(userId) {
  const submission = await prisma.kycSubmission.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      documentType: true,
      createdAt: true,
      updatedAt: true,
      submittedAt: true,
      reviewedAt: true,
      approvedAt: true,
      approvalExpiresAt: true,
      revokedAt: true,
      revokedReason: true,
      decisionReason: true,
      documentVerificationStatus: true,
      dataComparisonStatus: true,
      faceMatchStatus: true,
      livenessStatus: true,
      providerStatus: true,
      comparisonResults: true,
      documents: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          documentType: true,
          side: true,
          status: true,
          fileName: true,
          fileSizeBytes: true,
          mimeType: true,
          createdAt: true,
        },
      },
    },
  });

  if (!submission) {
    throw ApiError.notFound("No KYC submission found", "KYC_SUBMISSION_NOT_FOUND");
  }

  const approval = evaluateApproval(submission);
  // The limits reported here are the tier the platform currently applies, which
  // can be lower than what this submission would qualify for until an officer
  // records the decision.
  const tier = await tierService.effectiveTier(userId);
  return {
    ...submission,
    ...approval,
    tier: tier.tier
      ? {
          id: tier.tier.id,
          code: tier.tier.code,
          name: tier.tier.name,
          version: tier.tier.version,
          source: tier.source,
        }
      : null,
    limits: tier.limits,
    allowedOperations: tier.allowedOperations,
    requiresReVerification: tier.requiresReVerification,
  };
}

async function getInternalStatus(userId) {
  const latestSubmission = await prisma.kycSubmission.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      updatedAt: true,
      reviewedAt: true,
      approvedAt: true,
      approvalExpiresAt: true,
      revokedAt: true,
    },
  });

  // The newest application is authoritative: an approval stops counting once
  // a later application exists, expires, or is revoked.
  const approval = evaluateApproval(latestSubmission);
  // Additive tier payload: user-service keeps reading isApproved exactly as
  // before, and clamps each operation with these limits on top of its own
  // policy. A caller that ignores them is unchanged, so no existing integration
  // breaks while tiers are being rolled out.
  const tier = await tierService.effectiveTier(userId);
  return {
    userId,
    isApproved: approval.isApproved,
    status: latestSubmission?.status || "NOT_SUBMITTED",
    effectiveStatus: approval.effectiveStatus || "NOT_SUBMITTED",
    approvalExpired: approval.approvalExpired,
    submissionId: latestSubmission?.id || null,
    reviewedAt: latestSubmission?.reviewedAt || null,
    approvedAt: latestSubmission?.approvedAt || null,
    approvalExpiresAt: latestSubmission?.approvalExpiresAt || null,
    revokedAt: latestSubmission?.revokedAt || null,
    updatedAt: latestSubmission?.updatedAt || null,
    tierCode: tier.tier?.code ?? null,
    tierId: tier.tier?.id ?? null,
    tierVersion: tier.tier?.version ?? null,
    tierSource: tier.source,
    allowedOperations: tier.allowedOperations,
    limits: tier.limits,
    reVerificationDueAt: tier.expiresAt ?? null,
  };
}

module.exports = { createSubmission, getCurrentStatus, getInternalStatus };
