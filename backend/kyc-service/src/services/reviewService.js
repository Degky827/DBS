const prisma = require("../config/database");
const ApiError = require("../utils/ApiError");
const { SUBMISSION_STATUS, canTransition } = require("../constants/kycStatus");

const APPROVAL_REQUIREMENTS = {
  providerStatus: "Approved",
  documentVerificationStatus: "Approved",
  dataComparisonStatus: "MATCH",
  faceMatchStatus: "Approved",
  livenessStatus: "Approved",
};

async function getQueue() {
  return prisma.kycSubmission.findMany({
    where: { status: SUBMISSION_STATUS.PENDING_REVIEW },
    orderBy: { updatedAt: "asc" },
    select: {
      id: true,
      status: true,
      documentType: true,
      providerStatus: true,
      documentVerificationStatus: true,
      dataComparisonStatus: true,
      faceMatchStatus: true,
      livenessStatus: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { documents: true } },
    },
  });
}

async function decide({ submissionId, reviewerId, decision, reason }) {
  const submission = await prisma.kycSubmission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      userId: true,
      status: true,
      providerStatus: true,
      documentVerificationStatus: true,
      dataComparisonStatus: true,
      faceMatchStatus: true,
      livenessStatus: true,
    },
  });
  if (!submission) {
    throw ApiError.notFound("KYC submission not found", "KYC_SUBMISSION_NOT_FOUND");
  }
  if (submission.userId === reviewerId) {
    throw ApiError.forbidden("You cannot review your own KYC submission", "SELF_REVIEW_FORBIDDEN");
  }
  if (submission.status !== SUBMISSION_STATUS.PENDING_REVIEW) {
    throw ApiError.conflict("Submission is not awaiting review", "SUBMISSION_NOT_REVIEWABLE");
  }
  if (decision === "APPROVE") {
    const evidenceCount = await prisma.kycDocument.count({ where: { submissionId } });
    if (evidenceCount < 1) {
      throw ApiError.conflict(
        "Approval requires at least one submitted identity document",
        "APPROVAL_EVIDENCE_MISSING"
      );
    }
    if (
      Object.entries(APPROVAL_REQUIREMENTS).some(
        ([field, expected]) => submission[field] !== expected
      )
    ) {
      throw ApiError.conflict(
        "Approval requires an approved provider, document, face match, liveness, and matching profile data",
        "APPROVAL_REQUIREMENTS_NOT_MET"
      );
    }
  }

  const finalStatus = decision === "APPROVE"
    ? SUBMISSION_STATUS.APPROVED
    : SUBMISSION_STATUS.REJECTED;
  if (!canTransition(submission.status, finalStatus)) {
    throw ApiError.conflict(
      "Submission cannot be decided from its current status",
      "INVALID_KYC_STATUS_TRANSITION"
    );
  }
  return prisma.$transaction(async (tx) => {
    const transition = await tx.kycSubmission.updateMany({
      where: { id: submissionId, status: SUBMISSION_STATUS.PENDING_REVIEW },
      data: {
        status: finalStatus,
        reviewedAt: new Date(),
        decisionReason: reason,
      },
    });
    if (transition.count !== 1) {
      throw ApiError.conflict("Submission is not awaiting review", "SUBMISSION_NOT_REVIEWABLE");
    }
    const updated = await tx.kycSubmission.findUnique({
      where: { id: submissionId },
      select: { id: true, status: true, reviewedAt: true, decisionReason: true },
    });
    await tx.kycReview.create({
      data: {
        submissionId,
        reviewerId,
        decision,
        reason,
      },
    });
    await tx.kycAuditEvent.create({
      data: {
        submissionId,
        eventType: "OFFICER_DECISION_RECORDED",
        actorId: reviewerId,
        payload: { decision, finalStatus },
      },
    });
    return updated;
  });
}

module.exports = { getQueue, decide };
