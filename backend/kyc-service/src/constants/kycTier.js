// These lists mirror the CHECK constraints added by
// prisma/migrations/20261103090000_phase4_tiers_and_screening. The database
// rejects anything else, so a value that is valid here but missing there (or
// the other way round) fails at write time rather than silently diverging.

const TIER_OPERATIONS = Object.freeze([
  "DEPOSIT",
  "TRANSFER",
  "WITHDRAWAL",
  "PAYOUT",
  "SCHEDULED_TRANSFER",
]);

const ASSIGNMENT_DIRECTION = Object.freeze({
  INITIAL: "INITIAL",
  UPGRADE: "UPGRADE",
  DOWNGRADE: "DOWNGRADE",
  MAINTENANCE: "MAINTENANCE",
});

const ASSIGNMENT_STATUS = Object.freeze({
  REQUESTED: "REQUESTED",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
  SUPERSEDED: "SUPERSEDED",
});

// A tier code is only a ranking while the codes stay TIER_1 < TIER_2 ... The
// database enforces the shape of the code, so ordering by the numeric suffix is
// what "higher tier" means in this service.
const TIER_CODE_PATTERN = /^TIER_([0-9]+)$/;

const REASON = Object.freeze({
  APPROVAL_EXPIRING: "APPROVAL_EXPIRING",
  APPROVAL_EXPIRED: "APPROVAL_EXPIRED",
  DOCUMENT_EXPIRING: "DOCUMENT_EXPIRING",
  DOCUMENT_EXPIRED: "DOCUMENT_EXPIRED",
  PERIODIC_REVIEW: "PERIODIC_REVIEW",
  TIER_UPGRADE: "TIER_UPGRADE",
  SCREENING_FOLLOW_UP: "SCREENING_FOLLOW_UP",
  REVOKED: "REVOKED",
  MANUAL: "MANUAL",
});

const TASK_STATUS = Object.freeze({
  OPEN: "OPEN",
  NOTIFIED: "NOTIFIED",
  IN_PROGRESS: "IN_PROGRESS",
  SUBMITTED: "SUBMITTED",
  COMPLETED: "COMPLETED",
  OVERDUE: "OVERDUE",
  WAIVED: "WAIVED",
  CANCELLED: "CANCELLED",
});

// Anything the customer or an officer still owes. This is the set the partial
// unique index uses to keep one open task per reason.
const OPEN_TASK_STATUSES = Object.freeze([
  TASK_STATUS.OPEN,
  TASK_STATUS.NOTIFIED,
  TASK_STATUS.IN_PROGRESS,
  TASK_STATUS.SUBMITTED,
  TASK_STATUS.OVERDUE,
]);

// kyc-service can only prove a profile field when it appears in the document
// comparison, which reads firstName/lastName/dateOfBirth off the identity
// document (see services/comparisonService.js). A policy that names any other
// field is still stored and honoured, but it is reported to the reviewing
// officer as an attestation instead of a verification - the service never marks
// evidence it does not have as satisfied.
const VERIFIABLE_FIELDS = Object.freeze(["firstName", "lastName", "dateOfBirth"]);

const tierRank = (code) => {
  const match = TIER_CODE_PATTERN.exec(String(code || ""));
  return match ? Number(match[1]) : 0;
};

module.exports = {
  TIER_OPERATIONS,
  ASSIGNMENT_DIRECTION,
  ASSIGNMENT_STATUS,
  REASON,
  TASK_STATUS,
  OPEN_TASK_STATUSES,
  VERIFIABLE_FIELDS,
  tierRank,
};
