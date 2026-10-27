const crypto = require("crypto");
const prisma = require("../config/database");
const ApiError = require("../utils/ApiError");
const secureStorage = require("../utils/secureStorage");
const diditProvider = require("../providers/diditProvider");

async function createSession(userId, submissionId) {
  const submission = await prisma.kycSubmission.findFirst({
    where: { id: submissionId, userId },
    select: {
      id: true,
      status: true,
      providerSessionId: true,
      providerSessionUrlEncrypted: true,
    },
  });
  if (!submission) {
    throw ApiError.notFound("KYC submission not found", "KYC_SUBMISSION_NOT_FOUND");
  }
  if (submission.providerSessionId && submission.providerSessionUrlEncrypted) {
    return {
      sessionId: submission.providerSessionId,
      sessionUrl: secureStorage.decryptSensitiveValue(
        submission.providerSessionUrlEncrypted
      ),
      reused: true,
    };
  }
  if (!["DRAFT", "NEEDS_RESUBMISSION"].includes(submission.status)) {
    throw ApiError.conflict(
      "A verification session cannot be started for this submission",
      "SUBMISSION_NOT_READY"
    );
  }

  const providerSession = await diditProvider.createSession({ submissionId });
  const saved = await prisma.$transaction(async (tx) => {
    const updated = await tx.kycSubmission.update({
      where: { id: submissionId },
      data: {
        providerSessionId: providerSession.sessionId,
        providerSessionUrlEncrypted: secureStorage.encryptSensitiveValue(
          providerSession.sessionUrl
        ),
        providerStatus: "Not Started",
        status: "IN_PROGRESS",
      },
      select: {
        id: true,
        providerSessionId: true,
        providerSessionUrlEncrypted: true,
        status: true,
      },
    });
    await tx.kycAuditEvent.create({
      data: {
        submissionId,
        eventType: "DIDIT_SESSION_CREATED",
        actorId: userId,
      },
    });
    return updated;
  });

  return {
    sessionId: saved.providerSessionId,
    sessionUrl: secureStorage.decryptSensitiveValue(
      saved.providerSessionUrlEncrypted
    ),
    reused: false,
  };
}

function featureStatus(decision, key) {
  const results = decision?.[key];
  if (!Array.isArray(results) || results.length === 0) return null;
  const statuses = results.map((result) => result?.status).filter((status) => typeof status === "string");
  if (statuses.length === 0) return null;
  if (statuses.some((status) => status === "Declined")) return "Declined";
  if (statuses.some((status) => status === "In Review")) return "In Review";
  if (statuses.every((status) => status === "Approved")) return "Approved";
  return statuses[0];
}

function overallSubmissionStatus(providerStatus) {
  if (["Approved", "Declined", "In Review"].includes(providerStatus)) {
    return "PENDING_REVIEW";
  }
  if (["Expired", "KYC Expired", "Kyc Expired", "Abandoned"].includes(providerStatus)) {
    return "NEEDS_RESUBMISSION";
  }
  return "IN_PROGRESS";
}

function providerObjectId(event) {
  const candidates = [
    event.session_id,
    event.user_id,
    event.user?.id,
    event.business_id,
    event.business?.id,
    event.transaction_id,
    event.transaction?.id,
    event.activity_id,
    event.activity?.id,
    event.entity_id,
    event.id,
  ];
  return candidates.find((value) => typeof value === "string" && value.length > 0) || null;
}

function fallbackEventId(event) {
  const signedValues = [
    event.timestamp,
    event.session_id,
    event.status,
    event.webhook_type,
  ].join(":");
  return `simple-${crypto.createHash("sha256").update(signedValues).digest("hex")}`;
}

async function processWebhook(event, authenticationMethod) {
  if (
    !event ||
    typeof event.webhook_type !== "string" ||
    event.webhook_type.length === 0 ||
    event.webhook_type.length > 100 ||
    !Number.isSafeInteger(event.timestamp)
  ) {
    throw ApiError.badRequest("Webhook event is incomplete", "INVALID_WEBHOOK_EVENT");
  }
  if (!["v2", "raw", "simple"].includes(authenticationMethod)) {
    throw ApiError.unauthorized("Webhook signature method is invalid", "INVALID_WEBHOOK_SIGNATURE");
  }

  const isSessionEvent = ["status.updated", "data.updated"].includes(event.webhook_type);
  if (authenticationMethod === "simple" && !isSessionEvent) {
    throw ApiError.unauthorized(
      "The simple signature cannot authenticate this event type",
      "INVALID_WEBHOOK_SIGNATURE"
    );
  }

  const eventId =
    authenticationMethod === "simple"
      ? fallbackEventId(event)
      : event.event_id;
  if (typeof eventId !== "string" || eventId.length === 0 || eventId.length > 200) {
    throw ApiError.badRequest("Webhook event ID is invalid", "INVALID_WEBHOOK_EVENT");
  }

  const decision = authenticationMethod === "simple" ? null : event.decision;
  const eventStatus =
    typeof event.status === "string" ? event.status : decision?.status;
  const providerStatus =
    typeof eventStatus === "string" ? eventStatus : null;
  if (providerStatus && providerStatus.length > 100) {
    throw ApiError.badRequest("Webhook status is invalid", "INVALID_WEBHOOK_EVENT");
  }
  const objectId = providerObjectId(event);
  if (objectId && objectId.length > 200) {
    throw ApiError.badRequest("Webhook object ID is invalid", "INVALID_WEBHOOK_EVENT");
  }
  const submission = isSessionEvent && typeof event.session_id === "string"
    ? await prisma.kycSubmission.findUnique({
        where: { providerSessionId: event.session_id },
        select: { id: true },
      })
    : null;

  const documentVerificationStatus = featureStatus(decision, "id_verifications");
  const faceMatchStatus = featureStatus(decision, "face_matches");
  const livenessStatus = featureStatus(decision, "liveness_checks");
  const dataComparisonStatus = documentVerificationStatus
    ? ["Approved", "Declined"].includes(documentVerificationStatus)
      ? documentVerificationStatus === "Approved" ? "REVIEW_REQUIRED" : "MISMATCH"
      : "REVIEW_REQUIRED"
    : null;

  const submissionUpdate = {};
  if (submission && isSessionEvent) {
    if (providerStatus) {
      submissionUpdate.providerStatus = providerStatus;
      submissionUpdate.status = overallSubmissionStatus(providerStatus);
    }
    if (authenticationMethod !== "simple") {
      if (documentVerificationStatus) {
        submissionUpdate.documentVerificationStatus = documentVerificationStatus;
      }
      if (faceMatchStatus) submissionUpdate.faceMatchStatus = faceMatchStatus;
      if (livenessStatus) submissionUpdate.livenessStatus = livenessStatus;
      if (dataComparisonStatus) {
        submissionUpdate.dataComparisonStatus = dataComparisonStatus;
      }
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.kycProviderEvent.create({
        data: {
          eventId,
          submissionId: submission?.id || null,
          eventType: event.webhook_type,
          providerStatus,
          providerObjectId: objectId,
          eventTimestamp: new Date(event.timestamp * 1000),
        },
      });
      if (submission && Object.keys(submissionUpdate).length > 0) {
        await tx.kycSubmission.update({
          where: { id: submission.id },
          data: submissionUpdate,
        });
        await tx.kycAuditEvent.create({
          data: {
            submissionId: submission.id,
            eventType: "DIDIT_RESULT_RECEIVED",
            payload: {
              eventId,
              eventType: event.webhook_type,
              providerStatus,
              authenticationMethod,
              documentVerificationStatus,
              faceMatchStatus,
              livenessStatus,
            },
          },
        });
      }
    });
  } catch (error) {
    if (error?.code === "P2002") return { duplicate: true };
    throw error;
  }

  return { accepted: true, duplicate: false };
}

module.exports = { createSession, processWebhook };
