const ApiError = require("../utils/ApiError");

const SUBMISSION_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  IN_PROGRESS: "IN_PROGRESS",
  PENDING_REVIEW: "PENDING_REVIEW",
  NEEDS_RESUBMISSION: "NEEDS_RESUBMISSION",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
});

const EDITABLE_STATUSES = new Set([
  SUBMISSION_STATUS.DRAFT,
  SUBMISSION_STATUS.NEEDS_RESUBMISSION,
]);

const TERMINAL_STATUSES = new Set([
  SUBMISSION_STATUS.APPROVED,
  SUBMISSION_STATUS.REJECTED,
]);

// Applicant data may be compared while the submission is being verified or
// awaiting officer review. Comparisons only ever tighten the outcome, so
// running one during review is safe and prevents a review deadlock.
const COMPARABLE_STATUSES = new Set([
  SUBMISSION_STATUS.DRAFT,
  SUBMISSION_STATUS.IN_PROGRESS,
  SUBMISSION_STATUS.PENDING_REVIEW,
  SUBMISSION_STATUS.NEEDS_RESUBMISSION,
]);

const PROVIDER_STATUS_TO_SUBMISSION_STATUS = Object.freeze({
  Approved: SUBMISSION_STATUS.PENDING_REVIEW,
  Declined: SUBMISSION_STATUS.PENDING_REVIEW,
  "In Review": SUBMISSION_STATUS.PENDING_REVIEW,
  Expired: SUBMISSION_STATUS.NEEDS_RESUBMISSION,
  "KYC Expired": SUBMISSION_STATUS.NEEDS_RESUBMISSION,
  "Kyc Expired": SUBMISSION_STATUS.NEEDS_RESUBMISSION,
  Abandoned: SUBMISSION_STATUS.NEEDS_RESUBMISSION,
});

const ALLOWED_TRANSITIONS = Object.freeze({
  [SUBMISSION_STATUS.DRAFT]: new Set([
    SUBMISSION_STATUS.IN_PROGRESS,
    SUBMISSION_STATUS.PENDING_REVIEW,
    SUBMISSION_STATUS.NEEDS_RESUBMISSION,
  ]),
  [SUBMISSION_STATUS.IN_PROGRESS]: new Set([
    SUBMISSION_STATUS.PENDING_REVIEW,
    SUBMISSION_STATUS.NEEDS_RESUBMISSION,
  ]),
  [SUBMISSION_STATUS.PENDING_REVIEW]: new Set([
    SUBMISSION_STATUS.APPROVED,
    SUBMISSION_STATUS.REJECTED,
  ]),
  [SUBMISSION_STATUS.NEEDS_RESUBMISSION]: new Set([
    SUBMISSION_STATUS.IN_PROGRESS,
    SUBMISSION_STATUS.PENDING_REVIEW,
  ]),
  [SUBMISSION_STATUS.APPROVED]: new Set(),
  [SUBMISSION_STATUS.REJECTED]: new Set(),
});

function isEditable(status) {
  return EDITABLE_STATUSES.has(status);
}

function isTerminal(status) {
  return TERMINAL_STATUSES.has(status);
}

function isComparable(status) {
  return COMPARABLE_STATUSES.has(status);
}

function canTransition(from, to) {
  if (from === to) return true;
  return Boolean(ALLOWED_TRANSITIONS[from]?.has(to));
}

function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw ApiError.conflict(
      "KYC submission cannot transition to the requested status",
      "INVALID_KYC_STATUS_TRANSITION"
    );
  }
}

function submissionStatusForProvider(providerStatus) {
  if (typeof providerStatus !== "string") return null;
  return (
    PROVIDER_STATUS_TO_SUBMISSION_STATUS[providerStatus] ||
    SUBMISSION_STATUS.IN_PROGRESS
  );
}

module.exports = {
  SUBMISSION_STATUS,
  EDITABLE_STATUSES,
  TERMINAL_STATUSES,
  COMPARABLE_STATUSES,
  ALLOWED_TRANSITIONS,
  isEditable,
  isTerminal,
  isComparable,
  canTransition,
  assertTransition,
  submissionStatusForProvider,
};
