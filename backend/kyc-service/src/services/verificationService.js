const crypto = require("crypto");
const { Prisma } = require("@prisma/client");
const prisma = require("../config/database");
const ApiError = require("../utils/ApiError");
const secureStorage = require("../utils/secureStorage");
const diditProvider = require("../providers/diditProvider");
const {
  SUBMISSION_STATUS,
  isEditable,
  isTerminal,
  canTransition,
  submissionStatusForProvider,
} = require("../constants/kycStatus");

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
  if (!isEditable(submission.status)) {
    throw ApiError.conflict(
      "A verification session cannot be started for this submission",
      "SUBMISSION_NOT_READY"
    );
  }

  const providerSession = await diditProvider.createSession({ submissionId });
  const saved = await prisma.$transaction(async (tx) => {
    // A new provider session invalidates every prior provider and comparison
    // outcome. Leaving stale values in place could satisfy the officer
    // approval requirements for a different verification attempt.
    const transition = await tx.kycSubmission.updateMany({
      where: { id: submissionId, userId, status: submission.status },
      data: {
        providerSessionId: providerSession.sessionId,
        providerSessionUrlEncrypted: secureStorage.encryptSensitiveValue(
          providerSession.sessionUrl
        ),
        providerStatus: "Not Started",
        documentVerificationStatus: null,
        dataComparisonStatus: null,
        faceMatchStatus: null,
        livenessStatus: null,
        comparisonResults: Prisma.DbNull,
        status: SUBMISSION_STATUS.IN_PROGRESS,
      },
    });
    if (transition.count !== 1) {
      throw ApiError.conflict(
        "A verification session cannot be started for this submission",
        "SUBMISSION_NOT_READY"
      );
    }
    await tx.kycAuditEvent.create({
      data: {
        submissionId,
        eventType: "DIDIT_SESSION_CREATED",
        actorId: userId,
      },
    });
    return tx.kycSubmission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        providerSessionId: true,
        providerSessionUrlEncrypted: true,
        status: true,
      },
    });
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

async function lockSubmission(tx, submissionId) {
  const rows = await tx.$queryRaw`
    SELECT "id", "status"
    FROM "KycSubmission"
    WHERE "id" = ${submissionId}
    FOR UPDATE
  `;
  return rows?.[0] || null;
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
  const eventTimestamp = new Date(event.timestamp * 1000);

  let outcome;
  try {
    outcome = await prisma.$transaction(async (tx) => {
      let current = null;
      if (submission) {
        // Serialize webhook application per submission so that an older
        // event can never overwrite the result of a newer one.
        current = await lockSubmission(tx, submission.id);
      }

      const latestEvent = submission
        ? await tx.kycProviderEvent.findFirst({
            where: { submissionId: submission.id },
            orderBy: { eventTimestamp: "desc" },
            select: { eventTimestamp: true },
          })
        : null;

      await tx.kycProviderEvent.create({
        data: {
          eventId,
          submissionId: submission?.id || null,
          eventType: event.webhook_type,
          providerStatus,
          providerObjectId: objectId,
          eventTimestamp,
        },
      });

      if (!submission || !current) {
        return { applied: false, ignoredReason: null };
      }

      const submissionUpdate = {};
      let applied = false;
      let ignoredReason = null;

      if (isTerminal(current.status)) {
        ignoredReason = "TERMINAL_STATE";
      } else if (
        latestEvent?.eventTimestamp &&
        latestEvent.eventTimestamp > eventTimestamp
      ) {
        ignoredReason = "OUT_OF_ORDER_EVENT";
      } else {
        if (providerStatus) {
          const targetStatus = submissionStatusForProvider(providerStatus);
          if (targetStatus && !canTransition(current.status, targetStatus)) {
            ignoredReason = "INVALID_TRANSITION";
          } else {
            submissionUpdate.providerStatus = providerStatus;
            if (targetStatus && targetStatus !== current.status) {
              submissionUpdate.status = targetStatus;
            }
          }
        }

        if (!ignoredReason) {
          if (authenticationMethod !== "simple") {
            if (documentVerificationStatus) {
              submissionUpdate.documentVerificationStatus = documentVerificationStatus;
            }
            if (faceMatchStatus) submissionUpdate.faceMatchStatus = faceMatchStatus;
            if (livenessStatus) submissionUpdate.livenessStatus = livenessStatus;
          }
          // dataComparisonStatus is intentionally never derived from provider
          // data. It is owned exclusively by the applicant-data comparison.
          applied = Object.keys(submissionUpdate).length > 0;
        }
      }

      if (applied) {
        await tx.kycSubmission.update({
          where: { id: submission.id },
          data: submissionUpdate,
        });
      }

      await tx.kycAuditEvent.create({
        data: {
          submissionId: submission.id,
          eventType: applied ? "DIDIT_RESULT_RECEIVED" : "DIDIT_RESULT_IGNORED",
          payload: {
            eventId,
            eventType: event.webhook_type,
            providerStatus,
            authenticationMethod,
            applied,
            ignoredReason,
            previousStatus: current.status,
            nextStatus: submissionUpdate.status || current.status,
            documentVerificationStatus,
            faceMatchStatus,
            livenessStatus,
          },
        },
      });

      return { applied, ignoredReason };
    });
  } catch (error) {
    if (error?.code === "P2002") return { duplicate: true };
    throw error;
  }

  return { accepted: true, duplicate: false, ...outcome };
}

module.exports = { createSession, processWebhook };
