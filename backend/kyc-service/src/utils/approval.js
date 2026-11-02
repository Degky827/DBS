const { SUBMISSION_STATUS } = require("../constants/kycStatus");

// Approval is effective only while the submission is still APPROVED, has not
// been revoked, and has not passed its expiry. A null approvalExpiresAt means
// no expiry was recorded (legacy rows are backfilled by migration).
function evaluateApproval(submission, now = new Date()) {
  if (!submission) {
    return { isApproved: false, approvalExpired: false, effectiveStatus: null };
  }

  const approvalExpired =
    submission.status === SUBMISSION_STATUS.APPROVED &&
    Boolean(submission.approvalExpiresAt) &&
    submission.approvalExpiresAt.getTime() <= now.getTime();
  const revoked =
    submission.status === SUBMISSION_STATUS.APPROVED &&
    Boolean(submission.revokedAt);

  const effectiveStatus = approvalExpired
    ? "EXPIRED"
    : revoked
      ? "REVOKED"
      : submission.status;

  return {
    isApproved:
      submission.status === SUBMISSION_STATUS.APPROVED &&
      !approvalExpired &&
      !revoked,
    approvalExpired,
    effectiveStatus,
  };
}

module.exports = { evaluateApproval };
