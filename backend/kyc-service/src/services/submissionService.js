const prisma = require("../config/database");
const ApiError = require("../utils/ApiError");
const userServiceClient = require("./userServiceClient");

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
      documentVerificationStatus: true,
      dataComparisonStatus: true,
      faceMatchStatus: true,
      livenessStatus: true,
      providerStatus: true,
      comparisonResults: true,
    },
  });

  if (!submission) {
    throw ApiError.notFound("No KYC submission found", "KYC_SUBMISSION_NOT_FOUND");
  }

  return submission;
}

module.exports = { createSubmission, getCurrentStatus };
