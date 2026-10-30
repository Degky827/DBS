import { titleCase } from "../../utils/format";

const TONES = {
  DRAFT: "badge-neutral",
  IN_PROGRESS: "badge-info",
  PENDING_REVIEW: "badge-warning",
  NEEDS_RESUBMISSION: "badge-warning",
  APPROVED: "badge-success",
  REJECTED: "badge-danger",
  MATCH: "badge-success",
  MISMATCH: "badge-danger",
  REVIEW_REQUIRED: "badge-warning",
  Approved: "badge-success",
  Declined: "badge-danger",
  "In Review": "badge-warning",
  "Not Started": "badge-neutral",
  Expired: "badge-danger",
  "KYC Expired": "badge-danger",
  Abandoned: "badge-neutral",
  OCR_COMPLETE: "badge-success",
  UPLOADED: "badge-neutral",
  POSTED: "badge-success",
  COMPLETED: "badge-success",
  PENDING: "badge-warning",
  FAILED: "badge-danger",
  REVERSED: "badge-neutral",
  PARTIALLY_REVERSED: "badge-warning",
  CANCELLED: "badge-neutral",
  DEPOSIT: "badge-info",
  TRANSFER: "badge-neutral",
  WITHDRAWAL: "badge-warning",
  NOT_STARTED: "badge-neutral",
  NOT_SUBMITTED: "badge-neutral",
};

export default function StatusBadge({ value, fallback = "—", tone }) {
  const label = value ? titleCase(value) : fallback;
  const className = tone || TONES[value] || "badge-neutral";
  return <span className={className}>{label}</span>;
}
