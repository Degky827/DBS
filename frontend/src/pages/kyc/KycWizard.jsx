import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Check,
  CheckCircle2,
  ExternalLink,
  FileCheck2,
  FileText,
  Lock,
  ScanFace,
  ShieldCheck,
  Trash2,
  UploadCloud,
  UserRound,
  X,
} from "lucide-react";
import PageTransition from "../../components/ui/PageTransition";
import PageHeader from "../../components/ui/PageHeader";
import Alert from "../../components/ui/Alert";
import StatusBadge from "../../components/ui/StatusBadge";
import { Skeleton, Spinner } from "../../components/ui/Spinner";
import { ConfirmDialog } from "../../components/ui/Modal";
import { useAccount } from "../../context/AccountContext";
import {
  compareKycProfile,
  correctKycDocumentFields,
  createKycSubmission,
  deleteKycDocument,
  getKycDocument,
  getKycDocumentContent,
  getKycStatus,
  startVerificationSession,
  uploadKycDocument,
} from "../../services/kycService";
import { normalizeApiError } from "../../utils/apiError";
import {
  formatBytes,
  formatDate,
  isUninitializedDate,
  titleCase,
} from "../../utils/format";
import {
  KYC_ACCEPTED_TYPES,
  KYC_DOCUMENT_OPTIONS,
  KYC_MAX_FILE_BYTES,
  KYC_SIDE_OPTIONS,
  KYC_STEPS,
  currentKycStep,
  documentTypeLabel,
} from "../../utils/kyc";

const EMPTY_DOCUMENTS = [];
const EDITABLE_STATUSES = ["DRAFT", "NEEDS_RESUBMISSION"];
const TERMINAL_STATUSES = ["APPROVED", "REJECTED"];
const SESSION_READY_STATUSES = ["IN_PROGRESS", "PENDING_REVIEW"];

const profileIssues = (profile) => {
  const issues = [];
  if (!profile?.firstName) issues.push("first name");
  if (!profile?.lastName) issues.push("last name");
  if (!profile?.dateOfBirth || isUninitializedDate(profile.dateOfBirth)) {
    issues.push("date of birth");
  }
  return issues;
};

const stepComplete = (index, submission, documents) => {
  if (index === 0) return Boolean(submission);
  if (index === 1) return documents.length > 0;
  if (index === 2) {
    return SESSION_READY_STATUSES.includes(submission?.status) ||
      TERMINAL_STATUSES.includes(submission?.status);
  }
  return TERMINAL_STATUSES.includes(submission?.status);
};

function WizardStepper({ step, maxStep, submission, documents, onSelect }) {
  return (
    <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="Verification steps">
      {KYC_STEPS.map((item, index) => {
        const done = stepComplete(index, submission, documents);
        const current = index === step;
        const reachable = index <= maxStep;
        return (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onSelect(index)}
              disabled={!reachable}
              aria-current={current ? "step" : undefined}
              className={`w-full rounded-xl border px-3.5 py-3 text-left transition ${
                current
                  ? "border-brand-600/40 bg-brand-50"
                  : done
                    ? "border-ink-200 bg-white hover:border-brand-600/30"
                    : "border-ink-200 bg-ink-50/60"
              } disabled:cursor-not-allowed`}
            >
              <span className="flex items-center gap-2">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                    done
                      ? "bg-[#ecfdf3] text-success"
                      : current
                        ? "bg-brand-600 text-white"
                        : "bg-ink-200 text-muted"
                  }`}
                >
                  {done ? <Check size={13} /> : index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-bold text-midnight">
                    {item.label}
                  </span>
                  <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
                    {done ? "Complete" : current ? "Current step" : "Not started"}
                  </span>
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="text-[12.5px] text-muted">{label}</dt>
      <dd className="max-w-[65%] break-words text-right text-[12.5px] font-bold text-midnight">
        {value || "—"}
      </dd>
    </div>
  );
}

export default function KycWizard() {
  const { profile, loading: accountLoading, refresh: refreshAccount } = useAccount();

  const [submission, setSubmission] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState(null);
  const [step, setStep] = useState(0);
  const [pending, setPending] = useState(null);
  const [confirmNewApplication, setConfirmNewApplication] = useState(false);

  const [documentType, setDocumentType] = useState("national_id");
  const [side, setSide] = useState("front");
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState("");
  const [pendingPreview, setPendingPreview] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);

  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [document, setDocument] = useState(null);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [fieldDrafts, setFieldDrafts] = useState({});
  const [confirmRemove, setConfirmRemove] = useState("");

  const [sessionUrl, setSessionUrl] = useState("");
  const [comparison, setComparison] = useState(null);

  const fileInputRef = useRef(null);
  const previewUrlRef = useRef("");
  const mountedRef = useRef(true);

  const documents = submission?.documents ?? EMPTY_DOCUMENTS;
  const activeDocumentId = documents.some((item) => item.id === selectedDocumentId)
    ? selectedDocumentId
    : documents[documents.length - 1]?.id || "";
  const editable = Boolean(submission && EDITABLE_STATUSES.includes(submission.status));
  const terminal = Boolean(submission && TERMINAL_STATUSES.includes(submission.status));
  const comparable = Boolean(
    submission && ["IN_PROGRESS", "PENDING_REVIEW"].includes(submission.status)
  );
  const displayIssues = profileIssues(profile);
  const busy = Boolean(pending);

  const setPreview = useCallback((url) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = url;
    setPreviewUrl(url);
  }, []);

  const loadStatus = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const current = await getKycStatus();
      setSubmission(current);
      setLoadError("");
      if (Array.isArray(current?.comparisonResults) && current.comparisonResults.length > 0) {
        setComparison({
          status: current.dataComparisonStatus,
          fields: current.comparisonResults,
        });
      } else {
        setComparison(null);
      }
      return current;
    } catch (error) {
      const { status } = normalizeApiError(error);
      if (status === 404) {
        setSubmission(null);
        setLoadError("");
      } else if (status !== 401) {
        setLoadError(
          "We could not load your verification application. Refresh the page to try again."
        );
      }
      return null;
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let active = true;
    (async () => {
      const current = await loadStatus();
      if (!active || !current) return;
      if (!TERMINAL_STATUSES.includes(current.status)) {
        setStep(
          Math.min(currentKycStep(current, current.documents?.length || 0), 3)
        );
      }
    })();
    return () => {
      active = false;
      mountedRef.current = false;
    };
  }, [loadStatus]);

  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    []
  );

  useEffect(
    () => () => {
      if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    },
    [pendingPreview]
  );

  useEffect(() => {
    if (!activeDocumentId) return undefined;

    let active = true;
    (async () => {
      setDocumentLoading(true);
      try {
        const [details, content] = await Promise.all([
          getKycDocument(activeDocumentId),
          getKycDocumentContent(activeDocumentId),
        ]);
        if (!active) {
          URL.revokeObjectURL(content.url);
          return;
        }
        const drafts = {};
        for (const field of details?.extractedData?.fields || []) {
          drafts[field.key] = field.correctedValue ?? field.value ?? "";
        }
        setDocument(details);
        setFieldDrafts(drafts);
        setPreview(content.url);
      } catch (error) {
        if (!active) return;
        if (normalizeApiError(error).status !== 401) {
          setNotice({
            tone: "error",
            message: "We could not load this document. Refresh the page to try again.",
          });
        }
        setDocument(null);
        setPreview("");
      } finally {
        if (active) setDocumentLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [activeDocumentId, setPreview]);

  const handleFileChange = (event) => {
    const chosen = event.target.files?.[0] || null;
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingPreview("");
    setFileError("");
    setFile(null);

    if (!chosen) return;
    if (!KYC_ACCEPTED_TYPES.includes(chosen.type)) {
      event.target.value = "";
      setFileError("Choose a JPG, PNG, or WebP image.");
      return;
    }
    if (chosen.size > KYC_MAX_FILE_BYTES) {
      event.target.value = "";
      setFileError("Choose an image that is 10 MB or smaller.");
      return;
    }

    setPendingPreview(URL.createObjectURL(chosen));
    setFile(chosen);
  };

  const createApplication = async () => {
    if (busy) return null;
    setPending("create");
    setNotice(null);
    try {
      await createKycSubmission();
      const current = await loadStatus({ silent: true });
      await refreshAccount({ silent: true });
      if (!mountedRef.current) return null;
      setComparison(null);
      setSessionUrl("");
      setNotice({
        tone: "success",
        message: "Application created. Confirm your personal information to continue.",
      });
      if (current && !TERMINAL_STATUSES.includes(current.status)) {
        setStep(Math.min(currentKycStep(current, current.documents?.length || 0), 3));
      }
      return current;
    } catch (error) {
      setNotice({ tone: "error", message: normalizeApiError(error).message });
      return null;
    } finally {
      setPending(null);
    }
  };

  const handleStepOneContinue = async () => {
    if (displayIssues.length > 0) {
      setNotice({
        tone: "warning",
        message: `Add your ${displayIssues.join(", ")} to your profile before continuing.`,
      });
      return;
    }
    if (!submission || submission.status === "REJECTED") {
      await createApplication();
      return;
    }
    setStep(1);
  };

  const handleStartSession = async () => {
    if (busy || !submission?.id) return;
    if (documents.length === 0) {
      setNotice({
        tone: "warning",
        message: "Upload an identity document before starting the secure check.",
      });
      return;
    }

    setPending("session");
    setNotice(null);
    try {
      const result = await startVerificationSession(submission.id);
      if (!mountedRef.current) return;
      setSessionUrl(result.sessionUrl || "");
      if (!result.reused) setComparison(null);
      const current = await loadStatus({ silent: true });
      await refreshAccount({ silent: true });
      if (!mountedRef.current) return;
      setNotice({
        tone: "success",
        message: result.reused
          ? "Your secure session is ready to continue."
          : "Secure session created. Complete the face and liveness check in the provider window. Your application is sent for review only after the provider reports the result.",
      });
      if (!current) {
        setNotice({
          tone: "warning",
          message:
            "The session was created, but we could not reload the application. Refresh the page to see its latest state.",
        });
      }
    } catch (error) {
      setNotice({ tone: "error", message: normalizeApiError(error).message });
    } finally {
      setPending(null);
    }
  };

  const handleUpload = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!submission?.id) {
      setNotice({
        tone: "error",
        message: "Create your verification application before uploading a document.",
      });
      return;
    }
    if (!file) {
      setFileError("Choose an image to upload.");
      return;
    }

    setPending("upload");
    setNotice(null);
    setUploadProgress(0);
    try {
      const uploaded = await uploadKycDocument({
        submissionId: submission.id,
        documentType,
        side,
        file,
        onProgress: setUploadProgress,
      });
      if (!mountedRef.current) return;
      if (pendingPreview) URL.revokeObjectURL(pendingPreview);
      setPendingPreview("");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setSelectedDocumentId(uploaded.id);
      setStep(1);
      setNotice({
        tone: "success",
        message:
          "Document uploaded and processed. Check the extracted fields below and correct anything that was misread.",
      });
      await loadStatus({ silent: true });
      await refreshAccount({ silent: true });
    } catch (error) {
      setNotice({ tone: "error", message: normalizeApiError(error).message });
    } finally {
      setPending(null);
      setUploadProgress(0);
    }
  };

  const handleSaveCorrections = async () => {
    if (busy || !document?.id) return;
    const fields = (document.extractedData?.fields || [])
      .map(({ key }) => ({ key, value: (fieldDrafts[key] ?? "").trim() }))
      .filter(({ value }) => value.length > 0);

    if (fields.length === 0) {
      setNotice({
        tone: "error",
        message: "Enter at least one corrected value before saving.",
      });
      return;
    }

    setPending("corrections");
    setNotice(null);
    try {
      const updated = await correctKycDocumentFields(document.id, fields);
      if (!mountedRef.current) return;
      setDocument(updated);
      const drafts = {};
      for (const field of updated?.extractedData?.fields || []) {
        drafts[field.key] = field.correctedValue ?? field.value ?? "";
      }
      setFieldDrafts(drafts);
      setComparison(null);
      setNotice({
        tone: "success",
        message:
          "Extracted fields saved. The profile comparison will use these values after the secure check.",
      });
      await loadStatus({ silent: true });
      await refreshAccount({ silent: true });
    } catch (error) {
      setNotice({ tone: "error", message: normalizeApiError(error).message });
    } finally {
      setPending(null);
    }
  };

  const handleRemoveDocument = async () => {
    const documentId = confirmRemove;
    if (busy || !documentId) return;

    setPending("remove");
    setNotice(null);
    try {
      await deleteKycDocument(documentId);
      if (!mountedRef.current) return;
      if (activeDocumentId === documentId) {
        setSelectedDocumentId("");
        setDocument(null);
        setFieldDrafts({});
        setPreview("");
      }
      setConfirmRemove("");
      setNotice({
        tone: "success",
        message: "Document removed. Upload a replacement to continue.",
      });
      await loadStatus({ silent: true });
      await refreshAccount({ silent: true });
    } catch (error) {
      setNotice({ tone: "error", message: normalizeApiError(error).message });
    } finally {
      setPending(null);
    }
  };

  const handleCompare = async () => {
    if (busy || !submission?.id) return;
    setPending("compare");
    setNotice(null);
    try {
      const result = await compareKycProfile(submission.id);
      if (!mountedRef.current) return;
      setComparison(result);
      setNotice({
        tone: result.status === "MATCH" ? "success" : "warning",
        message:
          result.status === "MATCH"
            ? "Your profile matches the identity document."
            : "Some details could not be matched automatically. An officer will review the differences.",
      });
      await loadStatus({ silent: true });
      await refreshAccount({ silent: true });
    } catch (error) {
      setNotice({ tone: "error", message: normalizeApiError(error).message });
    } finally {
      setPending(null);
    }
  };

  const handleNewApplication = async () => {
    const created = await createApplication();
    if (created) {
      setConfirmNewApplication(false);
      setStep(1);
    }
  };

  const maxStep = terminal
    ? 3
    : !submission
      ? 0
      : documents.length === 0
        ? 1
        : SESSION_READY_STATUSES.includes(submission.status)
          ? 3
          : 2;

  const goToStep = (next) => {
    if (busy) return;
    if (next < 0) return;
    const limit = Math.max(maxStep, step);
    if (next > limit) return;
    setStep(next);
  };

  if (loading) {
    return (
      <PageTransition className="space-y-6">
        <PageHeader
          eyebrow="Identity verification"
          title="Verify your identity"
          description="Loading your verification application."
        />
        <div className="card space-y-4 p-6">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-full max-w-xl" />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {KYC_STEPS.map((item) => (
              <Skeleton key={item.id} className="h-20 w-full" />
            ))}
          </div>
        </div>
      </PageTransition>
    );
  }

  if (terminal) {
    const approved = submission.status === "APPROVED";
    return (
      <PageTransition className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          backTo="/kyc"
          backLabel="Identity verification"
          eyebrow="Identity verification"
          title={approved ? "Identity verified" : "Verification not approved"}
          description={
            approved
              ? "Your identity has been verified by a Meridian officer."
              : "The verification service has recorded a decision for this application."
          }
        />

        <div className="card p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <span
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${
                approved ? "bg-[#ecfdf3] text-success" : "bg-[#fef2f2] text-danger"
              }`}
            >
              {approved ? <BadgeCheck size={24} /> : <AlertCircle size={24} />}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-lg font-extrabold text-midnight">
                  {approved ? "Your identity is verified" : "This application was rejected"}
                </h2>
                <StatusBadge value={submission.status} />
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">
                {approved
                  ? "Transfers and payments are unlocked for your account. Nothing further is needed."
                  : "You can review the officer's reason, then start a new application with corrected information."}
              </p>
              {!approved && submission.decisionReason ? (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[12.5px] leading-relaxed text-red-700">
                  <span className="font-bold">Decision reason:</span>{" "}
                  {submission.decisionReason}
                </div>
              ) : null}
              {!approved && submission.reviewedAt ? (
                <p className="mt-3 text-[11px] text-muted">
                  Decision recorded {formatDate(submission.reviewedAt)}
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-2.5 border-t border-ink-100 pt-5">
            <Link to="/kyc/status" className="btn-primary">
              View verification status
            </Link>
            {approved ? (
              <Link to="/dashboard" className="btn-ghost">
                Back to dashboard
              </Link>
            ) : (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setConfirmNewApplication(true)}
                disabled={busy}
              >
                Start a new application
              </button>
            )}
          </div>
        </div>

        <ConfirmDialog
          open={confirmNewApplication}
          onClose={() => setConfirmNewApplication(false)}
          onConfirm={handleNewApplication}
          title="Start a new verification application?"
          description="Your existing rejected application stays on record. A new application starts from the first step and requires a fresh identity document."
          confirmLabel="Start new application"
          busy={pending === "create"}
        />
      </PageTransition>
    );
  }

  const summaryName = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ");
  const comparisonFields = comparison?.fields || submission?.comparisonResults || [];
  const comparisonStatus = comparison?.status || submission?.dataComparisonStatus;

  return (
    <PageTransition className="space-y-6">
      <PageHeader
        backTo="/kyc"
        backLabel="Identity verification"
        eyebrow="Identity verification"
        title={submission ? "Continue verification" : "Start verification"}
        description="Complete these steps once. Your document is encrypted at rest and reviewed only by authorised officers."
      />

      <Alert tone={notice?.tone || "info"} dismissible onDismiss={() => setNotice(null)}>
        {notice?.message}
      </Alert>

      {loadError ? (
        <div className="card space-y-3 p-6">
          <Alert tone="error">{loadError}</Alert>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setLoading(true);
              loadStatus();
            }}
            disabled={busy}
          >
            Retry
          </button>
        </div>
      ) : null}

      {!loadError ? (
        <>
          <div className="card p-4 sm:p-5">
            <WizardStepper
              step={step}
              maxStep={maxStep}
              submission={submission}
              documents={documents}
              onSelect={goToStep}
            />
          </div>

          {step === 0 ? (
            <div className="card">
              <div className="border-b border-ink-100 px-5 py-4 sm:px-6">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                  Step 1 of 4
                </p>
                <h2 className="mt-1 text-lg font-extrabold text-midnight">
                  Personal information
                </h2>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                  These details come from your profile and must match the identity document
                  exactly.
                </p>
              </div>

              <div className="px-5 py-5 sm:px-6">
                {!accountLoading && displayIssues.length > 0 ? (
                  <div className="mb-4 rounded-lg border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-[12.5px] leading-relaxed text-warning">
                    <span className="font-bold">Profile incomplete.</span> Add your{" "}
                    {displayIssues.join(", ")} before starting verification.
                  </div>
                ) : null}

                <dl className="divide-y divide-ink-100">
                  <SummaryRow label="Legal name" value={summaryName} />
                  <SummaryRow
                    label="Date of birth"
                    value={
                      profile?.dateOfBirth && !isUninitializedDate(profile.dateOfBirth)
                        ? formatDate(profile.dateOfBirth)
                        : ""
                    }
                  />
                  <SummaryRow label="Phone number" value={profile?.phoneNumber} />
                  <SummaryRow label="Email address" value={profile?.email} />
                  <SummaryRow
                    label="Address"
                    value={[profile?.addressLine1, profile?.city, profile?.country]
                      .filter(Boolean)
                      .join(", ")}
                  />
                </dl>

                <div className="mt-4 rounded-lg bg-ink-50 px-4 py-3 text-[12px] leading-relaxed text-muted">
                  To change these details, update your profile first. Changes made after a
                  document is uploaded require a new profile comparison.
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 px-5 py-4 sm:px-6">
                <Link to="/profile/edit" className="btn-ghost">
                  <UserRound size={15} /> Edit profile
                </Link>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleStepOneContinue}
                  disabled={busy || accountLoading || displayIssues.length > 0}
                >
                  {pending === "create" ? <Spinner size={15} /> : null}
                  {submission ? "Continue" : "Start application"} <ArrowRight size={15} />
                </button>
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-6">
              <div className="card">
                <div className="border-b border-ink-100 px-5 py-4 sm:px-6">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                    Step 2 of 4
                  </p>
                  <h2 className="mt-1 text-lg font-extrabold text-midnight">
                    Identity document
                  </h2>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                    Upload a clear, uncropped photo of a government-issued ID. JPG, PNG, or
                    WebP up to 10 MB.
                  </p>
                </div>

                <div className="px-5 py-5 sm:px-6">
                  {documents.length > 0 ? (
                    <div className="mb-5">
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                        Documents on file
                      </p>
                      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                        {documents.map((item) => (
                          <li key={item.id}>
                            <button
                              type="button"
                              onClick={() => setSelectedDocumentId(item.id)}
                              aria-pressed={activeDocumentId === item.id}
                              className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3.5 py-3 text-left transition ${
                                activeDocumentId === item.id
                                  ? "border-brand-600/40 bg-brand-50"
                                  : "border-ink-200 bg-white hover:border-brand-600/30"
                              }`}
                            >
                              <span className="flex min-w-0 items-center gap-2.5">
                                <FileText size={16} className="shrink-0 text-brand-700" />
                                <span className="min-w-0">
                                  <span className="block truncate text-[12.5px] font-bold text-midnight">
                                    {documentTypeLabel(item.documentType)}
                                    {item.side ? ` · ${titleCase(item.side)}` : ""}
                                  </span>
                                  <span className="block text-[11px] text-muted">
                                    {formatBytes(item.fileSizeBytes)} · {formatDate(item.createdAt)}
                                  </span>
                                </span>
                              </span>
                              <StatusBadge value={item.status} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {editable ? (
                    <form onSubmit={handleUpload} className="grid gap-4 md:grid-cols-2">
                      <label className="space-y-2">
                        <span className="field-label">Document type</span>
                        <select
                          className="field-input"
                          value={documentType}
                          onChange={(event) => setDocumentType(event.target.value)}
                          disabled={busy}
                        >
                          {KYC_DOCUMENT_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="space-y-2">
                        <span className="field-label">Side</span>
                        <select
                          className="field-input"
                          value={side}
                          onChange={(event) => setSide(event.target.value)}
                          disabled={busy}
                        >
                          {KYC_SIDE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <div className="md:col-span-2">
                        <label htmlFor="kyc-document-file" className="field-label">
                          Document image
                        </label>
                        <input
                          id="kyc-document-file"
                          ref={fileInputRef}
                          type="file"
                          accept={KYC_ACCEPTED_TYPES.join(",")}
                          onChange={handleFileChange}
                          className="field-input cursor-pointer"
                          disabled={busy}
                        />
                        {fileError ? <p className="field-error">{fileError}</p> : null}
                      </div>

                      {pendingPreview ? (
                        <div className="md:col-span-2">
                          <div className="overflow-hidden rounded-xl border border-ink-200 bg-ink-50">
                            <img
                              src={pendingPreview}
                              alt="Selected identity document preview"
                              className="max-h-64 w-full object-contain"
                            />
                          </div>
                          <p className="mt-1.5 text-[11px] text-muted">
                            {file?.name} · {formatBytes(file?.size)}
                          </p>
                        </div>
                      ) : null}

                      <div className="flex flex-wrap items-center gap-2.5 md:col-span-2">
                        <button
                          type="submit"
                          className="btn-primary"
                          disabled={busy || !file}
                        >
                          {pending === "upload" ? (
                            <Spinner size={15} />
                          ) : (
                            <UploadCloud size={15} />
                          )}
                          {pending === "upload" ? "Uploading…" : "Upload document"}
                        </button>
                        {file ? (
                          <button
                            type="button"
                            className="btn-ghost"
                            onClick={() => {
                              if (pendingPreview) URL.revokeObjectURL(pendingPreview);
                              setPendingPreview("");
                              setFile(null);
                              setFileError("");
                              if (fileInputRef.current) fileInputRef.current.value = "";
                            }}
                            disabled={busy}
                          >
                            <X size={15} /> Clear
                          </button>
                        ) : null}
                      </div>

                      {pending === "upload" ? (
                        <div className="md:col-span-2">
                          <div
                            className="h-1.5 overflow-hidden rounded-full bg-ink-200"
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={uploadProgress}
                            aria-label="Document upload progress"
                          >
                            <div
                              className="h-full rounded-full bg-brand-600 transition-[width]"
                              style={{ width: `${uploadProgress}%` }}
                            />
                          </div>
                          <p className="mt-1 text-[11px] text-muted">
                            {uploadProgress < 100
                              ? `Uploading ${uploadProgress}%`
                              : "Processing the image and reading the document…"}
                          </p>
                        </div>
                      ) : null}
                    </form>
                  ) : (
                    <div className="flex items-start gap-2.5 rounded-lg border border-ink-200 bg-ink-50 px-4 py-3 text-[12px] leading-relaxed text-muted">
                      <Lock size={15} className="mt-0.5 shrink-0" />
                      Documents are locked after the secure check starts. You can review the
                      uploaded file below.
                    </div>
                  )}
                </div>
              </div>

              {activeDocumentId ? (
                <div className="card">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4 sm:px-6">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                        Uploaded document
                      </p>
                      <h3 className="mt-1 text-[15px] font-extrabold text-midnight">
                        Review and correct extracted details
                      </h3>
                    </div>
                    {editable ? (
                      <button
                        type="button"
                        className="btn-danger-outline"
                        onClick={() => setConfirmRemove(activeDocumentId)}
                        disabled={busy}
                      >
                        <Trash2 size={14} /> Remove
                      </button>
                    ) : null}
                  </div>

                  <div className="px-5 py-5 sm:px-6">
                    {documentLoading ? (
                      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                        <Skeleton className="h-64 w-full" />
                        <div className="space-y-3">
                          <Skeleton className="h-4 w-32" />
                          <Skeleton className="h-9 w-full" />
                          <Skeleton className="h-9 w-full" />
                        </div>
                      </div>
                    ) : (
                      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
                        <div className="overflow-hidden rounded-xl border border-ink-200 bg-ink-50">
                          {previewUrl ? (
                            <img
                              src={previewUrl}
                              alt="Uploaded identity document"
                              className="max-h-[420px] w-full object-contain"
                            />
                          ) : (
                            <div className="flex min-h-[220px] items-center justify-center px-4 text-center text-[12px] text-muted">
                              Preview unavailable
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 space-y-4">
                          <dl className="divide-y divide-ink-100 rounded-lg bg-ink-50 px-3.5 py-1">
                            <SummaryRow
                              label="Type"
                              value={documentTypeLabel(document?.documentType)}
                            />
                            <SummaryRow
                              label="Side"
                              value={document?.side ? titleCase(document.side) : ""}
                            />
                            <SummaryRow
                              label="File size"
                              value={formatBytes(document?.fileSizeBytes)}
                            />
                            <SummaryRow label="Status" value={titleCase(document?.status)} />
                          </dl>

                          {(document?.extractedData?.fields || []).length > 0 ? (
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                                Extracted fields
                              </p>
                              <div className="mt-2 space-y-3">
                                {document.extractedData.fields.map((field) => (
                                  <label key={field.key} className="block">
                                    <span className="field-label">
                                      {field.label || field.key}
                                      {field.needsCorrection ? (
                                        <span className="ml-1 normal-case tracking-normal text-warning">
                                          · check this
                                        </span>
                                      ) : null}
                                    </span>
                                    <input
                                      className="field-input"
                                      value={fieldDrafts[field.key] ?? ""}
                                      onChange={(event) =>
                                        setFieldDrafts((previous) => ({
                                          ...previous,
                                          [field.key]: event.target.value,
                                        }))
                                      }
                                      disabled={!editable || busy}
                                    />
                                  </label>
                                ))}
                              </div>
                              {editable ? (
                                <button
                                  type="button"
                                  className="btn-secondary mt-3"
                                  onClick={handleSaveCorrections}
                                  disabled={busy}
                                >
                                  {pending === "corrections" ? <Spinner size={14} /> : null}
                                  Save corrections
                                </button>
                              ) : null}
                            </div>
                          ) : (
                            <p className="text-[12px] leading-relaxed text-muted">
                              No text fields were extracted from this image. A clearer photo may
                              improve the comparison.
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <button type="button" className="btn-ghost" onClick={() => goToStep(0)}>
                  <ArrowLeft size={15} /> Back
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => setStep(2)}
                  disabled={busy || documents.length === 0}
                >
                  Continue to secure check <ArrowRight size={15} />
                </button>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="card">
              <div className="border-b border-ink-100 px-5 py-4 sm:px-6">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                  Step 3 of 4
                </p>
                <h2 className="mt-1 text-lg font-extrabold text-midnight">
                  Face and liveness check
                </h2>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                  Our verification provider confirms that the person completing the check matches
                  the identity document. The session opens in a new tab.
                </p>
              </div>

              <div className="space-y-5 px-5 py-5 sm:px-6">
                <ul className="space-y-3">
                  {[
                    {
                      icon: ScanFace,
                      title: "A live face photo",
                      text: "You will be asked to look at the camera and follow a short prompt.",
                    },
                    {
                      icon: FileCheck2,
                      title: "The document you uploaded",
                      text: "The provider compares the portrait on your ID with your live image.",
                    },
                    {
                      icon: Lock,
                      title: "A private, encrypted session",
                      text: "The session link is short-lived. Never share it with anyone.",
                    },
                  ].map(({ icon: Icon, title, text }) => (
                    <li key={title} className="flex items-start gap-3 rounded-lg bg-ink-50 px-4 py-3">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-brand-700">
                        <Icon size={15} />
                      </span>
                      <div>
                        <p className="text-[12.5px] font-bold text-midnight">{title}</p>
                        <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{text}</p>
                      </div>
                    </li>
                  ))}
                </ul>

                {submission?.status === "PENDING_REVIEW" ? (
                  <div className="rounded-lg border border-brand-600/20 bg-brand-50 px-4 py-3 text-[12.5px] leading-relaxed text-brand-800">
                    <span className="font-bold">Provider checks received.</span> Your application
                    is with a verification officer. You can reopen the session only if the
                    provider asks you to repeat a check.
                  </div>
                ) : null}

                {sessionUrl ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-200 bg-white px-4 py-3">
                    <p className="text-[12.5px] font-semibold text-midnight">
                      Your secure session is ready.
                    </p>
                    <a
                      href={sessionUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-primary"
                    >
                      Open secure session <ExternalLink size={14} />
                    </a>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-2.5 border-t border-ink-100 pt-4">
                  {submission?.status === "IN_PROGRESS" ? (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={handleStartSession}
                      disabled={busy}
                    >
                      {pending === "session" ? <Spinner size={15} /> : <ShieldCheck size={15} />}
                      Reopen secure session
                    </button>
                  ) : submission?.status === "PENDING_REVIEW" ? null : (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={handleStartSession}
                      disabled={busy || documents.length === 0}
                    >
                      {pending === "session" ? <Spinner size={15} /> : <ShieldCheck size={15} />}
                      Start secure verification
                    </button>
                  )}
                  {documents.length === 0 ? (
                    <p className="text-[11.5px] text-warning">
                      Upload an identity document first.
                    </p>
                  ) : null}
                </div>

                <div className="rounded-lg border border-ink-200 px-4 py-3 text-[11.5px] leading-relaxed text-muted">
                  Creating the session does not approve your identity. Your application moves to
                  review only after the provider reports its result, and an officer records the
                  final decision.
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 px-5 py-4 sm:px-6">
                <button type="button" className="btn-ghost" onClick={() => goToStep(1)}>
                  <ArrowLeft size={15} /> Back
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setStep(3)}
                  disabled={busy}
                >
                  Review application <ArrowRight size={15} />
                </button>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-6">
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="card">
                  <div className="border-b border-ink-100 px-5 py-4">
                    <h2 className="text-[14px] font-extrabold text-midnight">
                      Applicant details
                    </h2>
                  </div>
                  <div className="px-5 py-3">
                    <dl className="divide-y divide-ink-100">
                      <SummaryRow label="Legal name" value={summaryName} />
                      <SummaryRow
                        label="Date of birth"
                        value={
                          profile?.dateOfBirth && !isUninitializedDate(profile.dateOfBirth)
                            ? formatDate(profile.dateOfBirth)
                            : ""
                        }
                      />
                      <SummaryRow label="Phone number" value={profile?.phoneNumber} />
                      <SummaryRow label="Email address" value={profile?.email} />
                      <SummaryRow
                        label="Address"
                        value={[profile?.addressLine1, profile?.city, profile?.country]
                          .filter(Boolean)
                          .join(", ")}
                      />
                    </dl>
                    <Link
                      to="/profile/edit"
                      className="mt-2 inline-block text-[12px] font-bold text-brand-700"
                    >
                      Update profile
                    </Link>
                  </div>
                </div>

                <div className="card">
                  <div className="border-b border-ink-100 px-5 py-4">
                    <h2 className="text-[14px] font-extrabold text-midnight">Documents</h2>
                  </div>
                  {documents.length === 0 ? (
                    <p className="px-5 py-6 text-[12.5px] text-muted">
                      No document has been uploaded.
                    </p>
                  ) : (
                    <ul className="divide-y divide-ink-100 px-5">
                      {documents.map((item) => (
                        <li key={item.id} className="flex items-center justify-between gap-3 py-3">
                          <div className="min-w-0">
                            <p className="truncate text-[12.5px] font-bold text-midnight">
                              {documentTypeLabel(item.documentType)}
                              {item.side ? ` · ${titleCase(item.side)}` : ""}
                            </p>
                            <p className="mt-0.5 text-[11px] text-muted">
                              {formatBytes(item.fileSizeBytes)} · {formatDate(item.createdAt)}
                            </p>
                          </div>
                          <StatusBadge value={item.status} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="card">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
                  <h2 className="text-[14px] font-extrabold text-midnight">
                    Automated checks
                  </h2>
                  <StatusBadge value={submission?.status} />
                </div>
                <dl className="divide-y divide-ink-100 px-5">
                  {[
                    ["Provider check", submission?.providerStatus, "Not started"],
                    [
                      "Document verification",
                      submission?.documentVerificationStatus,
                      "Pending",
                    ],
                    ["Profile comparison", comparisonStatus, "Not run"],
                    ["Face match", submission?.faceMatchStatus, "Pending"],
                    ["Liveness", submission?.livenessStatus, "Pending"],
                  ].map(([label, value, fallback]) => (
                    <div key={label} className="flex items-center justify-between gap-3 py-3">
                      <dt className="text-[12.5px] text-muted">{label}</dt>
                      <dd>
                        <StatusBadge value={value} fallback={fallback} />
                      </dd>
                    </div>
                  ))}
                </dl>

                {comparisonFields.length > 0 ? (
                  <div className="border-t border-ink-100 px-5 py-4">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                      Profile comparison
                    </p>
                    <ul className="mt-2 divide-y divide-ink-100">
                      {comparisonFields.map((field) => (
                        <li
                          key={field.field}
                          className="flex items-center justify-between gap-3 py-2 text-[12.5px]"
                        >
                          <span className="font-semibold text-midnight">
                            {titleCase(field.field)}
                          </span>
                          <StatusBadge value={field.status} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-3 border-t border-ink-100 px-5 py-4">
                  {comparable && documents.length > 0 ? (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={handleCompare}
                      disabled={busy}
                    >
                      {pending === "compare" ? <Spinner size={15} /> : <CheckCircle2 size={15} />}
                      {comparisonStatus === "MATCH"
                        ? "Re-run profile comparison"
                        : "Run profile comparison"}
                    </button>
                  ) : (
                    <p className="text-[12px] leading-relaxed text-muted">
                      {submission?.status === "DRAFT" ||
                      submission?.status === "NEEDS_RESUBMISSION"
                        ? "The profile comparison becomes available after the secure check starts. Starting a new session resets earlier comparisons."
                        : "No profile comparison is available for this application state."}
                    </p>
                  )}
                  <Link to="/kyc/status" className="btn-ghost">
                    Verification status
                  </Link>
                </div>
              </div>

              <div className="card p-5">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                    <ShieldCheck size={16} />
                  </span>
                  <div>
                    <h2 className="text-[13px] font-extrabold text-midnight">
                      {submission?.status === "PENDING_REVIEW"
                        ? "Awaiting officer review"
                        : submission?.status === "IN_PROGRESS"
                          ? "Waiting for the provider result"
                          : "What happens after this step"}
                    </h2>
                    <p className="mt-1 text-[12px] leading-relaxed text-muted">
                      {submission?.status === "PENDING_REVIEW"
                        ? "Your automated checks are complete. A verification officer will review the application and record the final decision."
                        : submission?.status === "IN_PROGRESS"
                          ? "Complete the face and liveness check in the provider session. When the provider reports the result, your application moves to officer review."
                          : "Start the secure check to send your application through the provider. An officer records the final decision after the automated checks finish."}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <button type="button" className="btn-ghost" onClick={() => goToStep(2)}>
                  <ArrowLeft size={15} /> Back
                </button>
                <button type="button" className="btn-secondary" onClick={() => setStep(0)}>
                  Review personal information
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      <ConfirmDialog
        open={Boolean(confirmRemove)}
        onClose={() => setConfirmRemove("")}
        onConfirm={handleRemoveDocument}
        title="Remove this document?"
        description="The stored image and its extracted fields will be deleted. You can upload a replacement immediately afterwards."
        confirmLabel="Remove document"
        busy={pending === "remove"}
      >
        <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-[12.5px] font-medium text-red-700">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          This action cannot be undone.
        </div>
      </ConfirmDialog>
    </PageTransition>
  );
}
