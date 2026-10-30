import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  Check,
  Clock3,
  FileText,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import PageTransition from "../../components/ui/PageTransition";
import PageHeader from "../../components/ui/PageHeader";
import Alert from "../../components/ui/Alert";
import StatusBadge from "../../components/ui/StatusBadge";
import { Skeleton, Spinner } from "../../components/ui/Spinner";
import { ConfirmDialog } from "../../components/ui/Modal";
import { useAccount } from "../../context/AccountContext";
import { compareKycProfile, createKycSubmission } from "../../services/kycService";
import { normalizeApiError } from "../../utils/apiError";
import { formatBytes, formatDateTime, titleCase } from "../../utils/format";
import { documentTypeLabel, isKycApproved, kycCopy } from "../../utils/kyc";

const COMPARABLE_STATUSES = ["IN_PROGRESS", "PENDING_REVIEW"];
const COMPLETED_CHECK_STATUSES = ["APPROVED", "REJECTED"];

const timelineIcon = (state) => {
  if (state === "done") return Check;
  if (state === "attention") return AlertCircle;
  if (state === "error") return X;
  if (state === "current") return Clock3;
  return FileText;
};

const timelineTone = (state) => {
  if (state === "done") return "bg-[#ecfdf3] text-success";
  if (state === "attention") return "bg-[#fffbeb] text-warning";
  if (state === "error") return "bg-[#fef2f2] text-danger";
  if (state === "current") return "bg-brand-600 text-white";
  return "bg-ink-100 text-muted";
};

const checkSummary = (check) => check ?? "Not started";

export default function KycStatus() {
  const navigate = useNavigate();
  const { kyc, loading, kycUnavailable, refresh, profile } = useAccount();
  const [notice, setNotice] = useState(null);
  const [pending, setPending] = useState(null);
  const [confirmNewApplication, setConfirmNewApplication] = useState(false);

  const documents = kyc?.documents || [];
  const status = kyc?.status;
  const approved = isKycApproved(kyc);
  const rejected = status === "REJECTED";
  const needsResubmission = status === "NEEDS_RESUBMISSION";
  const pendingReview = status === "PENDING_REVIEW";
  const inProgress = status === "IN_PROGRESS";
  const comparable =
    kyc && COMPARABLE_STATUSES.includes(status) && documents.length > 0;
  const comparisonReady = kyc?.dataComparisonStatus === "MATCH";
  const copy = kycCopy(kyc);
  const busy = Boolean(pending);

  const checksComplete =
    Boolean(kyc?.providerStatus) &&
    (pendingReview || COMPLETED_CHECK_STATUSES.includes(status));

  const timeline = [
    {
      key: "created",
      title: "Application created",
      description: kyc
        ? "Your verification application was created and saved."
        : "No verification application exists yet.",
      state: kyc ? "done" : "pending",
      at: kyc?.createdAt,
    },
    {
      key: "document",
      title: "Identity document added",
      description:
        documents.length > 0
          ? `${documents.length} document${documents.length === 1 ? "" : "s"} uploaded and processed.`
          : "Upload a government-issued photo ID to continue.",
      state:
        documents.length > 0 ? "done" : kyc && status === "DRAFT" ? "current" : "pending",
      at: documents[0]?.createdAt,
    },
    {
      key: "checks",
      title: "Automated checks",
      description: needsResubmission
        ? "The provider could not complete the checks for this attempt. Replace your document and try again."
        : checksComplete
          ? "Provider, document, face, and liveness checks have been received."
          : inProgress
            ? "Complete the face and liveness session so the provider can return a result."
            : "These begin after you start the secure check.",
      state: needsResubmission
        ? "attention"
        : pendingReview || COMPLETED_CHECK_STATUSES.includes(status)
          ? "done"
          : inProgress
            ? "current"
            : "pending",
      at: null,
    },
    {
      key: "submitted",
      title: "Submitted for review",
      description: kyc?.submittedAt
        ? "Your provider results were recorded and the application entered officer review."
        : "Recorded automatically when the provider returns your check results.",
      state: kyc?.submittedAt ? "done" : "pending",
      at: kyc?.submittedAt,
    },
    {
      key: "decision",
      title: "Officer decision",
      description: approved
        ? "A verification officer approved your identity."
        : rejected
          ? "A verification officer rejected this application. Review the reason below."
          : pendingReview
            ? "Waiting for a verification officer to review your application."
            : "A verification officer records the final decision after the automated checks.",
      state: approved ? "done" : rejected ? "error" : pendingReview ? "current" : "pending",
      at: kyc?.reviewedAt,
    },
  ];

  const handleCompare = async () => {
    if (busy || !kyc?.id) return;
    setPending("compare");
    setNotice(null);
    try {
      const result = await compareKycProfile(kyc.id);
      setNotice({
        tone: result.status === "MATCH" ? "success" : "warning",
        message:
          result.status === "MATCH"
            ? "Your profile matches the identity document. Your application is ready for an officer decision."
            : "Some details could not be matched automatically. An officer will review the differences.",
      });
      await refresh({ silent: true });
    } catch (error) {
      setNotice({ tone: "error", message: normalizeApiError(error).message });
    } finally {
      setPending(null);
    }
  };

  const handleNewApplication = async () => {
    if (busy) return;
    setPending("create");
    setNotice(null);
    try {
      await createKycSubmission();
      await refresh({ silent: true });
      setConfirmNewApplication(false);
      navigate("/kyc/verify");
    } catch (error) {
      setNotice({ tone: "error", message: normalizeApiError(error).message });
    } finally {
      setPending(null);
    }
  };

  const primaryAction = () => {
    if (!kyc) {
      return (
        <Link to="/kyc/verify" className="btn-primary">
          Start verification <ArrowRight size={15} />
        </Link>
      );
    }
    if (approved) {
      return (
        <Link to="/dashboard" className="btn-primary">
          Back to dashboard <ArrowRight size={15} />
        </Link>
      );
    }
    if (rejected) {
      return (
        <button
          type="button"
          className="btn-primary"
          onClick={() => setConfirmNewApplication(true)}
          disabled={busy}
        >
          Start a new application
        </button>
      );
    }
    return (
      <Link to="/kyc/verify" className="btn-primary">
        {needsResubmission
          ? "Resubmit document"
          : inProgress
            ? "Continue secure check"
            : pendingReview
              ? "Review application"
              : "Continue verification"}{" "}
        <ArrowRight size={15} />
      </Link>
    );
  };

  return (
    <PageTransition className="space-y-6">
      <PageHeader
        backTo="/kyc"
        backLabel="Identity verification"
        eyebrow="Identity verification"
        title="Verification status"
        description="The authoritative state of your application, including the officer's recorded decision."
        actions={
          <button
            type="button"
            className="btn-ghost"
            onClick={() => refresh()}
            disabled={loading || busy}
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        }
      />

      <Alert tone={notice?.tone || "info"} dismissible onDismiss={() => setNotice(null)}>
        {notice?.message}
      </Alert>

      {kycUnavailable ? (
        <Alert tone="warning">
          We could not reach the verification service. Refresh to try again.
        </Alert>
      ) : null}

      {loading && !kyc ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <div className="card space-y-4 p-6">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-36 w-full" />
          </div>
          <div className="card space-y-3 p-6">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <div className="space-y-6">
            <div className="card p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                      approved
                        ? "bg-[#ecfdf3] text-success"
                        : rejected
                          ? "bg-[#fef2f2] text-danger"
                          : needsResubmission
                            ? "bg-[#fffbeb] text-warning"
                            : "bg-brand-50 text-brand-700"
                    }`}
                  >
                    {approved ? (
                      <BadgeCheck size={21} />
                    ) : rejected ? (
                      <AlertCircle size={21} />
                    ) : needsResubmission ? (
                      <ShieldAlert size={21} />
                    ) : (
                      <ShieldCheck size={21} />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                      Current status
                    </p>
                    <h2 className="mt-1 text-xl font-extrabold tracking-tight text-midnight">
                      {copy.headline}
                    </h2>
                    <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-muted">
                      {copy.description}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <StatusBadge value={status || "NOT_STARTED"} />
                  {kyc ? (
                    <p className="text-[11px] text-muted">
                      Updated {formatDateTime(kyc.updatedAt)}
                    </p>
                  ) : null}
                </div>
              </div>

              {kyc?.decisionReason ? (
                <div
                  className={`mt-4 rounded-lg border px-4 py-3 text-[12.5px] leading-relaxed ${
                    rejected
                      ? "border-red-200 bg-red-50 text-red-700"
                      : "border-[#fde68a] bg-[#fffbeb] text-warning"
                  }`}
                >
                  <span className="font-bold">Decision reason:</span> {kyc.decisionReason}
                </div>
              ) : null}

              {needsResubmission && !kyc?.decisionReason ? (
                <div className="mt-4 rounded-lg border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-[12.5px] leading-relaxed text-warning">
                  The verification provider could not complete this attempt. Replace your
                  document and run the secure check again.
                </div>
              ) : null}

              {kyc ? (
                <div className="mt-4 text-[11.5px] text-muted">
                  Application created {formatDateTime(kyc.createdAt)}
                  {kyc.submittedAt
                    ? ` · Submitted for review ${formatDateTime(kyc.submittedAt)}`
                    : ""}
                  {kyc.reviewedAt ? ` · Decision recorded ${formatDateTime(kyc.reviewedAt)}` : ""}
                </div>
              ) : null}

              <div className="mt-5 flex flex-wrap items-center gap-2.5 border-t border-ink-100 pt-4">
                {primaryAction()}
                {comparable && !comparisonReady ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleCompare}
                    disabled={busy}
                  >
                    {pending === "compare" ? <Spinner size={14} /> : null}
                    Run profile comparison
                  </button>
                ) : null}
                <Link to="/profile" className="btn-ghost">
                  Profile
                </Link>
              </div>

              {comparable && comparisonReady ? (
                <p className="mt-3 text-[12px] leading-relaxed text-success">
                  Your profile matches the identity document. No further action is needed from
                  you while an officer completes the review.
                </p>
              ) : null}
            </div>

            <div className="card">
              <div className="border-b border-ink-100 px-5 py-4">
                <h2 className="text-[14px] font-extrabold text-midnight">Application timeline</h2>
                <p className="mt-0.5 text-[11.5px] text-muted">
                  Timestamps come from the verification service, not this browser.
                </p>
              </div>
              <div className="px-5 py-5">
                <ol className="relative">
                  {timeline.map((item, index) => {
                    const Icon = timelineIcon(item.state);
                    return (
                      <li
                        key={item.key}
                        className="relative flex gap-3.5 pb-6 last:pb-0"
                      >
                        {index < timeline.length - 1 ? (
                          <span
                            aria-hidden="true"
                            className="absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-px bg-ink-200"
                          />
                        ) : null}
                        <span
                          className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${timelineTone(
                            item.state
                          )}`}
                        >
                          <Icon size={15} />
                        </span>
                        <div className="min-w-0 pt-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <p className="text-[12.5px] font-bold text-midnight">{item.title}</p>
                            {item.at ? (
                              <span className="text-[10.5px] text-muted">
                                {formatDateTime(item.at)}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">
                            {item.description}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="card">
              <div className="border-b border-ink-100 px-5 py-4">
                <h2 className="text-[14px] font-extrabold text-midnight">Automated checks</h2>
              </div>
              <dl className="divide-y divide-ink-100 px-5">
                {[
                  ["Provider check", kyc?.providerStatus],
                  ["Document verification", kyc?.documentVerificationStatus],
                  ["Profile comparison", kyc?.dataComparisonStatus],
                  ["Face match", kyc?.faceMatchStatus],
                  ["Liveness", kyc?.livenessStatus],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-3 py-3">
                    <dt className="text-[12.5px] text-muted">{label}</dt>
                    <dd>
                      <StatusBadge value={value} fallback={checkSummary(value)} />
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="border-t border-ink-100 px-5 py-3 text-[11px] leading-relaxed text-muted">
                Automated results support the review; they never approve or reject your
                application on their own.
              </div>
            </div>

            <div className="card">
              <div className="border-b border-ink-100 px-5 py-4">
                <h2 className="text-[14px] font-extrabold text-midnight">Documents on file</h2>
              </div>
              {documents.length === 0 ? (
                <p className="px-5 py-6 text-[12.5px] leading-relaxed text-muted">
                  No identity document has been uploaded for this application.
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
                          {formatBytes(item.fileSizeBytes)} · {formatDateTime(item.createdAt)}
                        </p>
                      </div>
                      <StatusBadge value={item.status} />
                    </li>
                  ))}
                </ul>
              )}
              <div className="border-t border-ink-100 px-5 py-3 text-[11px] leading-relaxed text-muted">
                Document images are stored encrypted. They are available only to you and
                authorised verification officers.
              </div>
            </div>

            {profile && !profile.firstName ? (
              <div className="rounded-xl border border-ink-200 bg-white p-4 text-[12px] leading-relaxed text-muted">
                Your profile is missing a legal name.{" "}
                <Link to="/profile/edit" className="font-bold text-brand-700">
                  Update your profile
                </Link>{" "}
                before starting a new application.
              </div>
            ) : null}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmNewApplication}
        onClose={() => setConfirmNewApplication(false)}
        onConfirm={handleNewApplication}
        title="Start a new verification application?"
        description="Your previous application stays on record. The new application starts from the first step and requires a fresh identity document and secure check."
        confirmLabel="Start new application"
        busy={pending === "create"}
      />
    </PageTransition>
  );
}
