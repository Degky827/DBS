import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  AlertTriangle,
  CheckCircle2,
  FileImage,
  FileText,
  Eye,
  Lock,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import {
  getOfficerDocumentContent,
  getOfficerSubmission,
  submitOfficerDecision,
} from "../../services/kycService";
import { normalizeApiError } from "../../utils/apiError";
import { formatBytes, formatDateTime, titleCase } from "../../utils/format";
import { documentTypeLabel } from "../../utils/kyc";
import PageHeader from "../../components/ui/PageHeader";
import Alert from "../../components/ui/Alert";
import Modal from "../../components/ui/Modal";
import StatusBadge from "../../components/ui/StatusBadge";
import { Spinner } from "../../components/ui/Spinner";

const CHECKS = [
  ["providerStatus", "Provider verification", "Approved"],
  ["documentVerificationStatus", "Document authenticity", "Approved"],
  ["dataComparisonStatus", "Profile data comparison", "MATCH"],
  ["faceMatchStatus", "Face match", "Approved"],
  ["livenessStatus", "Liveness", "Approved"],
];

const checkPassed = (submission, field) => {
  const expected = CHECKS.find(([key]) => key === field)?.[2];
  return Boolean(submission?.[field]) && submission[field] === expected;
};

export default function OfficerReviewDetail() {
  const { submissionId } = useParams();
  const { user } = useSelector((state) => state.auth);

  const [submission, setSubmission] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");

  const [viewer, setViewer] = useState(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [viewerError, setViewerError] = useState("");
  const viewerRequestRef = useRef(0);
  const viewerUrlRef = useRef(null);

  const [decision, setDecision] = useState(null);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [decisionError, setDecisionError] = useState("");

  const closeViewer = useCallback(() => {
    viewerRequestRef.current += 1;
    if (viewerUrlRef.current) {
      URL.revokeObjectURL(viewerUrlRef.current);
      viewerUrlRef.current = null;
    }
    setViewer(null);
    setViewerLoading(false);
    setViewerError("");
  }, []);

  useEffect(() => () => closeViewer(), [closeViewer]);

  const load = async () => {
    try {
      const data = await getOfficerSubmission(submissionId);
      setSubmission(data.submission);
      setLoadError("");
    } catch (requestError) {
      setLoadError(normalizeApiError(requestError).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await getOfficerSubmission(submissionId);
        if (!active) return;
        setSubmission(data.submission);
        setLoadError("");
      } catch (requestError) {
        if (!active) return;
        setLoadError(normalizeApiError(requestError).message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [submissionId]);

  const openDocument = async (document) => {
    const requestId = viewerRequestRef.current + 1;
    viewerRequestRef.current = requestId;
    if (viewerUrlRef.current) {
      URL.revokeObjectURL(viewerUrlRef.current);
      viewerUrlRef.current = null;
    }
    setViewer({ document, url: null, mimeType: document.mimeType });
    setViewerError("");
    setViewerLoading(true);
    try {
      const { url, mimeType } = await getOfficerDocumentContent(document.id);
      if (requestId !== viewerRequestRef.current) {
        URL.revokeObjectURL(url);
        return;
      }
      viewerUrlRef.current = url;
      setViewer({ document, url, mimeType });
    } catch (requestError) {
      if (requestId !== viewerRequestRef.current) return;
      setViewerError(normalizeApiError(requestError).message);
    } finally {
      if (requestId === viewerRequestRef.current) setViewerLoading(false);
    }
  };

  const requirementsMet =
    Boolean(submission) &&
    (submission.documents?.length ?? 0) > 0 &&
    CHECKS.every(([field]) => checkPassed(submission, field));
  const isOwnSubmission = Boolean(user?.id && submission?.userId === user.id);
  const reviewable = submission?.status === "PENDING_REVIEW";
  const canDecide = reviewable && !isOwnSubmission;

  const openDecision = (type) => {
    setDecision(type);
    setReason("");
    setConfirming(false);
    setDecisionError("");
  };

  const closeDecision = () => {
    if (submitting) return;
    setDecision(null);
    setConfirming(false);
    setReason("");
    setDecisionError("");
  };

  const proceed = () => {
    if (reason.trim().length < 5) {
      setDecisionError("Provide a reason of at least 5 characters.");
      return;
    }
    setDecisionError("");
    setConfirming(true);
  };

  const submit = async () => {
    setSubmitting(true);
    setDecisionError("");
    try {
      const result = await submitOfficerDecision(submissionId, {
        decision,
        reason: reason.trim(),
      });
      setNotice(
        `Decision recorded by the verification service. The submission is now ${titleCase(result.status)}.`
      );
      setDecision(null);
      setConfirming(false);
      setReason("");
      await load();
    } catch (requestError) {
      setDecisionError(normalizeApiError(requestError).message);
      setConfirming(false);
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-[13px] font-semibold text-ink-500">
        <Spinner size={18} className="text-brand-600" /> Loading submission…
      </div>
    );
  }

  if (loadError || !submission) {
    return (
      <div className="space-y-4">
        <PageHeader
          eyebrow="Verification officer"
          title="Review submission"
          backTo="/officer/verifications"
          backLabel="Back to queue"
        />
        <Alert tone="error">{loadError || "This submission could not be loaded."}</Alert>
      </div>
    );
  }

  const documents = submission.documents ?? [];
  const reviews = submission.reviews ?? [];
  const events = submission.events ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Verification officer"
        title="Review submission"
        description="Confirm the automated checks, inspect the encrypted evidence in the secure viewer, then record a final decision."
        backTo="/officer/verifications"
        backLabel="Back to queue"
        actions={
          <>
            <button type="button" className="btn-ghost" onClick={load}>
              Refresh
            </button>
            {canDecide ? (
              <>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => openDecision("REJECT")}
                >
                  <ShieldX size={15} /> Reject
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => openDecision("APPROVE")}
                  disabled={!requirementsMet}
                >
                  <ShieldCheck size={15} /> Approve
                </button>
              </>
            ) : null}
          </>
        }
      />

      {notice ? (
        <Alert tone="success" dismissible onDismiss={() => setNotice("")}>
          {notice}
        </Alert>
      ) : null}

      {isOwnSubmission ? (
        <Alert tone="warning">
          This submission belongs to your own account. Self-review is prohibited, so the decision
          controls are disabled.
        </Alert>
      ) : !reviewable ? (
        <Alert tone="info">
          This submission is <span className="font-bold">{titleCase(submission.status)}</span> and
          no longer accepts a decision. Decisions already recorded are shown below.
        </Alert>
      ) : !requirementsMet ? (
        <Alert tone="warning">
          Approval requirements are not met. Approval stays disabled until the provider, document,
          comparison, face and liveness checks pass. Rejection is still available.
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card p-5 lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-ink-400">
                Submission
              </p>
              <p className="mt-1 break-all font-mono text-[12.5px] font-semibold text-midnight">
                {submission.id}
              </p>
              <p className="mt-1 break-all text-[12px] text-muted">
                Customer reference {submission.userId}
              </p>
            </div>
            <StatusBadge value={submission.status} />
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-[12.5px] sm:grid-cols-3">
            {[
              ["Document type", submission.documentType ? documentTypeLabel(submission.documentType) : "—"],
              ["Created", formatDateTime(submission.createdAt)],
              ["Submitted", submission.submittedAt ? formatDateTime(submission.submittedAt) : "Not submitted"],
              ["Updated", formatDateTime(submission.updatedAt)],
              ["Reviewed", submission.reviewedAt ? formatDateTime(submission.reviewedAt) : "Not reviewed"],
              [
                "Verification score",
                submission.verificationScore === null || submission.verificationScore === undefined
                  ? "—"
                  : `${Math.round(submission.verificationScore * 100)}%`,
              ],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink-400">
                  {label}
                </dt>
                <dd className="mt-0.5 font-semibold text-body">{value}</dd>
              </div>
            ))}
          </dl>

          {submission.decisionReason ? (
            <div className="mt-5 rounded-lg border border-ink-100 bg-ink-50 px-4 py-3">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink-400">
                Recorded decision reason
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-body">
                {submission.decisionReason}
              </p>
            </div>
          ) : null}
        </section>

        <section className="card p-5">
          <h2 className="text-[15px] font-extrabold text-midnight">Completeness</h2>
          <p className="mt-0.5 text-[12px] text-muted">
            {requirementsMet
              ? "All automated checks passed."
              : "Every check must pass before approval."}
          </p>
          <ul className="mt-4 space-y-2.5">
            <li className="flex items-center justify-between gap-3 text-[12.5px]">
              <span className="text-body">Identity document</span>
              {documents.length > 0 ? (
                <span className="inline-flex items-center gap-1.5 font-semibold text-success">
                  <CheckCircle2 size={14} /> {documents.length} uploaded
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 font-semibold text-danger">
                  <AlertTriangle size={14} /> Missing
                </span>
              )}
            </li>
            {CHECKS.map(([field, label, expected]) => {
              const passed = checkPassed(submission, field);
              return (
                <li key={field} className="flex items-center justify-between gap-3 text-[12.5px]">
                  <span className="text-body">{label}</span>
                  <span className="flex items-center gap-2">
                    <StatusBadge value={submission[field]} fallback="Not started" />
                    {passed ? (
                      <CheckCircle2 size={14} className="text-success" aria-label="Passed" />
                    ) : (
                      <AlertTriangle size={14} className="text-warning" aria-label={`Requires ${expected}`} />
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-5 py-4">
          <div>
            <h2 className="text-[15px] font-extrabold text-midnight">Identity documents</h2>
            <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
              <Lock size={12} /> Files are decrypted per request with your officer session and
              logged as document access.
            </p>
          </div>
        </div>

        {documents.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13px] text-muted">
            No identity documents were uploaded for this submission.
          </p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {documents.map((document) => (
              <li
                key={document.id}
                className="flex flex-wrap items-center gap-3 px-5 py-3.5"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-ink-500">
                  <FileImage size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold text-midnight">
                    {documentTypeLabel(document.documentType)}
                    {document.side ? ` · ${titleCase(document.side)}` : ""}
                  </p>
                  <p className="truncate text-[11.5px] text-muted">
                    {document.fileName} · {formatBytes(document.fileSizeBytes)} ·{" "}
                    {titleCase(document.mimeType)}
                  </p>
                </div>
                <StatusBadge value={document.status} fallback="Uploaded" />
                <button
                  type="button"
                  className="btn-ghost !py-2 !text-[12.5px]"
                  onClick={() => openDocument(document)}
                >
                  <Eye size={14} /> Secure view
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="text-[15px] font-extrabold text-midnight">Review history</h2>
          <p className="mt-0.5 text-[12px] text-muted">
            Decisions are append-only. A submission accepts exactly one final decision.
          </p>
          {reviews.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-muted">
              No decision has been recorded yet.
            </p>
          ) : (
            <ol className="mt-4 space-y-3">
              {reviews.map((review) => (
                <li key={review.id} className="rounded-lg border border-ink-100 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <StatusBadge value={review.decision} />
                    <span className="text-[11.5px] text-muted">
                      {formatDateTime(review.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-body">
                    {review.reason || "No reason supplied."}
                  </p>
                  <p className="mt-1 break-all font-mono text-[10.5px] text-muted">
                    Reviewer {review.reviewerId}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="card p-5">
          <h2 className="text-[15px] font-extrabold text-midnight">Audit activity</h2>
          <p className="mt-0.5 text-[12px] text-muted">
            Most recent verification events for this submission.
          </p>
          {events.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-muted">No events recorded.</p>
          ) : (
            <ol className="mt-4 space-y-2.5">
              {events.map((event) => (
                <li
                  key={event.id}
                  className="flex items-start justify-between gap-3 border-b border-ink-100 pb-2.5 text-[12px] last:border-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-midnight">{titleCase(event.eventType)}</p>
                    {event.actorId ? (
                      <p className="break-all font-mono text-[10.5px] text-muted">
                        Actor {event.actorId}
                      </p>
                    ) : null}
                  </div>
                  <span className="whitespace-nowrap text-[11px] text-muted">
                    {formatDateTime(event.createdAt)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <p className="flex items-center gap-2 text-[11.5px] text-muted">
        <FileText size={13} /> Resubmission requests are not supported by the verification
        service; a submission receives exactly one APPROVE or REJECT decision.
      </p>

      <Modal
        open={Boolean(viewer)}
        onClose={closeViewer}
        title="Secure document viewer"
        description={
          viewer?.document
            ? `${documentTypeLabel(viewer.document.documentType)}${
                viewer.document.side ? ` · ${titleCase(viewer.document.side)}` : ""
              }`
            : ""
        }
        size="lg"
        footer={
          <button type="button" className="btn-ghost" onClick={closeViewer}>
            Close viewer
          </button>
        }
      >
        <div className="space-y-3">
          <Alert tone="info">
            Rendered from a short-lived in-memory blob. No public URL is created; the file is
            released when this viewer closes.
          </Alert>
          {viewerError ? <Alert tone="error">{viewerError}</Alert> : null}
          <div className="flex min-h-[18rem] items-center justify-center overflow-hidden rounded-lg border border-ink-200 bg-ink-50">
            {viewerLoading ? (
              <Spinner size={20} className="text-brand-600" />
            ) : viewer?.url ? (
              viewer.mimeType.startsWith("image/") ? (
                <img
                  src={viewer.url}
                  alt="Submitted identity document"
                  className="max-h-[60vh] w-full object-contain"
                />
              ) : viewer.mimeType === "application/pdf" ? (
                <iframe
                  src={viewer.url}
                  title="Submitted identity document"
                  className="h-[60vh] w-full"
                />
              ) : (
                <p className="px-4 text-center text-[13px] text-muted">
                  This file type cannot be previewed here.
                </p>
              )
            ) : (
              <p className="px-4 text-center text-[13px] text-muted">
                {viewerError ? "The document could not be decrypted." : "Preparing document…"}
              </p>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(decision)}
        onClose={closeDecision}
        title={confirming ? "Confirm final decision" : decision === "APPROVE" ? "Approve submission" : "Reject submission"}
        description={
          confirming
            ? "This writes the decision to the verification service and cannot be undone."
            : "Record why this decision is being made. The reason is stored with the review."
        }
        footer={
          confirming ? (
            <>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setConfirming(false)}
                disabled={submitting}
              >
                Back
              </button>
              <button
                type="button"
                className={decision === "APPROVE" ? "btn-primary" : "btn-danger"}
                onClick={submit}
                disabled={submitting}
              >
                {submitting ? <Spinner size={15} /> : null}
                {decision === "APPROVE" ? "Confirm approval" : "Confirm rejection"}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn-ghost" onClick={closeDecision}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={proceed}>
                Continue
              </button>
            </>
          )
        }
      >
        {confirming ? (
          <div className="space-y-3 text-[13px]">
            <dl className="space-y-2 rounded-lg bg-ink-50 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">Decision</dt>
                <dd>
                  <StatusBadge
                    value={decision}
                    tone={decision === "APPROVE" ? "badge-success" : "badge-danger"}
                  />
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="text-muted">Submission</dt>
                <dd className="break-all text-right font-mono text-[11.5px] text-body">
                  {submission.id}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Reason</dt>
                <dd className="mt-1 text-[12.5px] leading-relaxed text-body">{reason.trim()}</dd>
              </div>
            </dl>
            {decision === "APPROVE" ? (
              <Alert tone="warning">
                Approval unlocks transfers and payments for this customer. Confirm that the
                document, face match and liveness checks above are correct.
              </Alert>
            ) : null}
            {decisionError ? <Alert tone="error">{decisionError}</Alert> : null}
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block">
              <span className="field-label">Decision reason</span>
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={4}
                maxLength={1000}
                className="field-input"
                placeholder="Explain the basis for this decision (5–1000 characters)."
              />
              <span className="mt-1 block text-[11px] text-muted">
                {reason.trim().length}/1000
              </span>
            </label>
            {decision === "APPROVE" && !requirementsMet ? (
              <Alert tone="warning">
                Approval requirements are not met. This decision will be rejected by the server.
              </Alert>
            ) : null}
            {decisionError ? <Alert tone="error">{decisionError}</Alert> : null}
          </div>
        )}
      </Modal>
    </div>
  );
}
