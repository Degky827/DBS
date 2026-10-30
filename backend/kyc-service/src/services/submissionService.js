const prisma = require("../config/database");
const ApiError = require("../utils/ApiError");
const userServiceClient = require("./userServiceClient");
const { SUBMISSION_STATUS } = require("../constants/kycStatus");

async function createSubmission(userId, authorization) {
  await userServiceClient.getMyProfile(authorization);

  return prisma.$transaction(async (tx) => {
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

  return submission;
}

async function getInternalStatus(userId) {
  const [latestSubmission, latestDecision] = await Promise.all([
    prisma.kycSubmission.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, updatedAt: true },
    }),
    prisma.kycSubmission.findFirst({
      where: { userId, reviewedAt: { not: null } },
      orderBy: { reviewedAt: "desc" },
      select: { id: true, status: true, reviewedAt: true },
    }),
  ]);

  // The most recent completed officer decision is authoritative. A newer
  // in-progress or draft submission does not revoke an existing approval.
  return {
    userId,
    isApproved: latestDecision?.status === SUBMISSION_STATUS.APPROVED,
    status: latestSubmission?.status || "NOT_SUBMITTED",
    submissionId: latestSubmission?.id || null,
    reviewedAt: latestDecision?.reviewedAt || null,
    updatedAt: latestSubmission?.updatedAt || null,
  };
}

module.exports = { createSubmission, getCurrentStatus, getInternalStatus };
