export const KYC_STEPS = [
  {
    id: "profile",
    label: "Personal information",
    description: "Confirm the details your identity must match.",
  },
  {
    id: "document",
    label: "Identity document",
    description: "Upload a clear government-issued photo ID.",
  },
  {
    id: "provider",
    label: "Face and liveness check",
    description: "Complete the secure provider session.",
  },
  {
    id: "decision",
    label: "Review decision",
    description: "A verification officer records the final outcome.",
  },
];

export const KYC_STATUS_COPY = {
  DRAFT: {
    label: "Draft",
    headline: "Finish your verification",
    description:
      "Your application is saved as a draft. Add your identity document and complete the secure checks.",
    nextLabel: "Continue verification",
    nextTo: "/kyc/verify",
    tone: "warning",
  },
  IN_PROGRESS: {
    label: "In progress",
    headline: "Complete the secure check",
    description:
      "Your document has been received. Finish the face and liveness session to send your application for review.",
    nextLabel: "Continue secure check",
    nextTo: "/kyc/verify",
    tone: "warning",
  },
  PENDING_REVIEW: {
    label: "Pending review",
    headline: "Your application is under review",
    description:
      "All automated checks are complete. A verification officer will record the decision.",
    nextLabel: "View verification status",
    nextTo: "/kyc/status",
    tone: "info",
  },
  NEEDS_RESUBMISSION: {
    label: "Needs resubmission",
    headline: "Your document needs attention",
    description:
      "Replace the identity document with a clearer image, then complete the secure checks again.",
    nextLabel: "Resubmit document",
    nextTo: "/kyc/verify",
    tone: "warning",
  },
  REJECTED: {
    label: "Not approved",
    headline: "Verification was not approved",
    description:
      "Review the decision reason. If you are eligible, you can start a new verification application.",
    nextLabel: "View decision",
    nextTo: "/kyc/status",
    tone: "danger",
  },
  APPROVED: {
    label: "Approved",
    headline: "Your identity is verified",
    description:
      "Transfers and payments are unlocked for your account. Your verified details are used only for compliance.",
    nextLabel: "View verification details",
    nextTo: "/kyc/status",
    tone: "success",
  },
};

export const currentKycStep = (submission, documentCount = 0) => {
  if (!submission) return 0;
  switch (submission.status) {
    case "NEEDS_RESUBMISSION":
      return 1;
    case "DRAFT":
      return documentCount > 0 ? 2 : 1;
    case "IN_PROGRESS":
      return 2;
    case "PENDING_REVIEW":
      return 3;
    case "APPROVED":
    case "REJECTED":
      return 4;
    default:
      return 0;
  }
};

export const kycCopy = (submission) => {
  if (!submission) {
    return {
      label: "Not started",
      headline: "Verify your identity",
      description:
        "Identity verification is required before you can transfer funds or make payments.",
      nextLabel: "Start verification",
      nextTo: "/kyc",
      tone: "neutral",
    };
  }
  return (
    KYC_STATUS_COPY[submission.status] || {
      label: submission.status,
      headline: "Verification in progress",
      description: "We are checking your verification details.",
      nextLabel: "View verification status",
      nextTo: "/kyc/status",
      tone: "info",
    }
  );
};

export const isKycEditable = (status) =>
  status === "DRAFT" || status === "NEEDS_RESUBMISSION";

export const isKycApproved = (submission) => submission?.status === "APPROVED";

export const KYC_DOCUMENT_OPTIONS = [
  { value: "passport", label: "Passport" },
  { value: "national_id", label: "National ID" },
  { value: "drivers_license", label: "Driver's licence" },
  { value: "residence_permit", label: "Residence permit" },
];

export const KYC_SIDE_OPTIONS = [
  { value: "front", label: "Front" },
  { value: "back", label: "Back" },
];

export const KYC_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const KYC_ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export const documentTypeLabel = (value) =>
  KYC_DOCUMENT_OPTIONS.find((option) => option.value === value)?.label || value || "Document";
