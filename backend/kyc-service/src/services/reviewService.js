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

async function getQueue(options = {}) {
  const status = options.status || SUBMISSION_STATUS.PENDING_REVIEW;
  const limit = options.limit || 25;
  const where = {
    ...(status === "ALL" ? {} : { status }),
    ...(options.q
      ? {
          OR: [
            { id: { contains: options.q, mode: "insensitive" } },
            { userId: { contains: options.q, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(options.from || options.to
      ? {
          createdAt: {
            ...(options.from ? { gte: new Date(options.from) } : {}),
            ...(options.to ? { lte: new Date(options.to) } : {}),
          },
        }
      : {}),
  };

  if (options.cursor) {
    const cursorSubmission = await prisma.kycSubmission.findFirst({
      where: { id: options.cursor, ...where },
      select: { id: true },
    });
    if (!cursorSubmission) {
      throw ApiError.badRequest(
        "Review cursor is invalid for this filter",
        "INVALID_REVIEW_CURSOR"
      );
    }
  }

  const sort =
    options.sort || (status === SUBMISSION_STATUS.PENDING_REVIEW ? "oldest" : "newest");
  const orderBy =
    sort === "oldest"
      ? [{ updatedAt: "asc" }, { id: "asc" }]
      : [{ updatedAt: "desc" }, { id: "desc" }];

  const [rows, total] = await Promise.all([
    prisma.kycSubmission.findMany({
      where,
      orderBy,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      take: limit + 1,
      select: {
        id: true,
        userId: true,
        status: true,
        documentType: true,
        submittedAt: true,
        reviewedAt: true,
        providerStatus: true,
        documentVerificationStatus: true,
        dataComparisonStatus: true,
        faceMatchStatus: true,
        livenessStatus: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { documents: true } },
        reviews: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { reviewerId: true, decision: true, createdAt: true },
        },
      },
    }),
    prisma.kycSubmission.count({ where }),
  ]);

  const hasMore = rows.length > limit;
  const submissions = rows.slice(0, limit);
  return {
    submissions,
    page: {
      limit,
      hasMore,
      nextCursor: hasMore ? submissions[submissions.length - 1].id : null,
      total,
    },
  };
}

async function getStats() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [statusRows, reviewRows, oldestPending] = await Promise.all([
    prisma.kycSubmission.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.kycReview.groupBy({
      by: ["decision"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.kycSubmission.findFirst({
      where: { status: SUBMISSION_STATUS.PENDING_REVIEW },
      orderBy: { updatedAt: "asc" },
      select: { updatedAt: true },
    }),
  ]);

  const byStatus = Object.fromEntries(
    Object.values(SUBMISSION_STATUS).map((value) => [value, 0])
  );
  for (const row of statusRows) {
    byStatus[row.status] = row._count._all;
  }
  const reviews = Object.fromEntries(
    reviewRows.map((row) => [row.decision, row._count._all])
  );

  return {
    byStatus,
    reviewsLast30Days: {
      approve: reviews.APPROVE || 0,
      reject: reviews.REJECT || 0,
    },
    oldestPendingAt: oldestPending?.updatedAt ?? null,
    generatedAt: new Date(),
  };
}

async function getSubmission(submissionId) {
  const submission = await prisma.kycSubmission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      userId: true,
      status: true,
      documentType: true,
      createdAt: true,
      updatedAt: true,
      submittedAt: true,
      reviewedAt: true,
      verificationScore: true,
      decisionReason: true,
      providerStatus: true,
      documentVerificationStatus: true,
      dataComparisonStatus: true,
      faceMatchStatus: true,
      livenessStatus: true,
      documents: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          documentType: true,
          mimeType: true,
          fileName: true,
          fileSizeBytes: true,
          side: true,
          status: true,
          createdAt: true,
        },
      },
      reviews: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          reviewerId: true,
          decision: true,
          reason: true,
          createdAt: true,
        },
      },
      events: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          eventType: true,
          actorId: true,
          createdAt: true,
        },
      },
    },
  });
  if (!submission) {
    throw ApiError.notFound("KYC submission not found", "KYC_SUBMISSION_NOT_FOUND");
  }
  return { submission };
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

module.exports = { getQueue, getStats, getSubmission, decide };
