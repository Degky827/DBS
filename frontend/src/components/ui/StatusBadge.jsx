import { titleCase } from "../../utils/format";

const TONES = {
  DRAFT: "badge-neutral",
  IN_PROGRESS: "badge-info",
  PENDING_REVIEW: "badge-warning",
  NEEDS_RESUBMISSION: "badge-danger",
  APPROVED: "badge-success",
  REJECTED: "badge-danger",
  MATCH: "badge-success",
  MISMATCH: "badge-danger",
  REVIEW_REQUIRED: "badge-warning",
  "Approved": "badge-success",
  "Declined": "badge-danger",
  "In Review": "badge-warning",
  "Not Started": "badge-neutral",
  Expired: "badge-danger",
  "KYC Expired": "badge-danger",
  Abandoned: "badge-neutral",
  OCR_COMPLETE: "badge-success",
  UPLOADED: "badge-neutral",
};

export default function StatusBadge({ value, fallback = "—", tone }) {
  const label = value ? titleCase(value) : fallback;
  const className = tone || TONES[value] || "badge-neutral";
  return <span className={className}>{label}</span>;
}
