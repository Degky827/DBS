import { useCallback, useEffect, useRef, useState } from "react";
import { FileImage, FileSearch, ShieldCheck } from "lucide-react";
import {
  getOfficerDocumentContent,
  getOfficerReviews,
  getOfficerSubmissionDocuments,
  submitOfficerDecision,
} from "../../services/kycService";
import { normalizeApiError } from "../../utils/apiError";
import { formatDateTime, titleCase } from "../../utils/format";
import PageTransition, { StaggerGroup, StaggerItem } from "../../components/ui/PageTransition";
import PageHeader from "../../components/ui/PageHeader";
import Alert from "../../components/ui/Alert";
import StatusBadge from "../../components/ui/StatusBadge";
import EmptyState from "../../components/ui/EmptyState";
import Modal from "../../components/ui/Modal";
import { Spinner } from "../../components/ui/Spinner";

const APPROVAL_REQUIREMENTS = (review) =>
  (review?._count?.documents ?? 0) > 0 &&
  review?.providerStatus === "Approved" &&
  review?.documentVerificationStatus === "Approved" &&
  review?.dataComparisonStatus === "MATCH" &&
  review?.faceMatchStatus === "Approved" &&
  review?.livenessStatus === "Approved";

export default function OfficerReviews() {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState(null);
  const [decision, setDecision] = useState("APPROVE");
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [evidence, setEvidence] = useState([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState("");
  const objectUrlsRef = useRef(new Set());
  const evidenceRequestRef = useRef(0);

  const releaseEvidenceUrls = useCallback(() => {
    for (const url of objectUrlsRef.current) URL.revokeObjectURL(url);
    objectUrlsRef.current.clear();
  }, []);

  useEffect(() => () => releaseEvidenceUrls(), [releaseEvidenceUrls]);

  const clearEvidence = useCallback(() => {
    evidenceRequestRef.current += 1;
    releaseEvidenceUrls();
    setEvidence([]);
    setEvidenceLoading(false);
    setEvidenceError("");
  }, [releaseEvidenceUrls]);

  const loadEvidence = async (submissionId) => {
    const requestId = evidenceRequestRef.current + 1;
    evidenceRequestRef.current = requestId;
    releaseEvidenceUrls();
    setEvidence([]);
    setEvidenceError("");
    setEvidenceLoading(true);

    try {
      const result = await getOfficerSubmissionDocuments(submissionId);
      if (requestId !== evidenceRequestRef.current) return;

      const documents = Array.isArray(result?.documents) ? result.documents : [];
      setEvidence(
        documents.map((document) => ({
          ...document,
          url: null,
          loading: true,
          error: "",
        }))
      );
      setEvidenceLoading(false);

      await Promise.all(
        documents.map(async (document) => {
          try {
            const { url } = await getOfficerDocumentContent(document.id);
            if (requestId !== evidenceRequestRef.current) {
              URL.revokeObjectURL(url);
              return;
            }
            objectUrlsRef.current.add(url);
            setEvidence((current) =>
              current.map((item) =>
                item.id === document.id ? { ...item, url, loading: false } : item
              )
            );
          } catch (error) {
            if (requestId !== evidenceRequestRef.current) return;
            setEvidence((current) =>
              current.map((item) =>
                item.id === document.id
                  ? {
                      ...item,
                      loading: false,
                      error:
                        normalizeApiError(error).message || "Evidence unavailable",
                    }
                  : item
              )
            );
          }
        })
      );
    } catch (error) {
      if (requestId !== evidenceRequestRef.current) return;
      setEvidenceError(
        normalizeApiError(error).message || "Unable to load submitted evidence"
      );
      setEvidenceLoading(false);
    }
  };

  const load = useCallback(async () => {
    try {
      const list = await getOfficerReviews();
      setReviews(Array.isArray(list) ? list : []);
      setLoadError("");
    } catch (error) {
      const { message } = normalizeApiError(error);
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = () => {
    setLoading(true);
    load();
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const list = await getOfficerReviews();
        if (!mounted) return;
        setReviews(Array.isArray(list) ? list : []);
        setLoadError("");
      } catch (error) {
        if (!mounted) return;
        setLoadError(normalizeApiError(error).message);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const openReview = (review) => {
    clearEvidence();
    setSelected(review);
    setDecision(APPROVAL_REQUIREMENTS(review) ? "APPROVE" : "REJECT");
    setReason("");
    setFormError("");
    loadEvidence(review.id);
  };

  const closeReview = () => {
    clearEvidence();
    setSelected(null);
    setFormError("");
  };

  const submit = async () => {
    if (!selected?.id) return;
    const trimmed = reason.trim();
    if (trimmed.length < 5) {
      setFormError("Provide a reason of at least 5 characters.");
      return;
    }
    if (decision === "APPROVE" && !APPROVAL_REQUIREMENTS(selected)) {
      setFormError("Approval requirements are not met for this submission.");
      return;
    }

    setBusy(true);
    setFormError("");
    try {
      await submitOfficerDecision(selected.id, { decision, reason: trimmed });
      closeReview();
      await load();
    } catch (error) {
      const { message } = normalizeApiError(error);
      setFormError(message);
    } finally {
      setBusy(false);
    }
  };

  const requirementsMet = selected ? APPROVAL_REQUIREMENTS(selected) : false;
  const checks = selected
    ? [
        { label: "Provider", value: selected.providerStatus, fallback: "Not started" },
        { label: "Document", value: selected.documentVerificationStatus, fallback: "Pending" },
        { label: "Data comparison", value: selected.dataComparisonStatus, fallback: "Pending" },
        { label: "Face match", value: selected.faceMatchStatus, fallback: "Pending" },
        { label: "Liveness", value: selected.livenessStatus, fallback: "Pending" },
      ]
    : [];

  return (
    <PageTransition className="space-y-6">
      <PageHeader
        eyebrow="Verification officer"
        title="Review queue"
        description="Submissions waiting for a manual decision. Approval is only available when every automated check has passed."
        actions={
          <button type="button" className="btn-ghost" onClick={refresh} disabled={loading || busy}>
            <Spinner size={15} /> Refresh
          </button>
        }
      />

      <Alert tone={loadError ? "error" : "info"}>{loadError || `${reviews.length} submission${reviews.length === 1 ? "" : "s"} awaiting review`}</Alert>

      {loading ? (
        <div className="card flex items-center justify-center gap-3 px-5 py-16 text-sm font-semibold text-ink-500" role="status">
          <Spinner className="text-navy-600" /> Loading review queue…
        </div>
      ) : reviews.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No submissions waiting"
          description="When customers submit documents and finish their provider session, submissions appear here for a final decision."
        />
      ) : (
        <StaggerGroup className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Submission</th>
                  <th>Document</th>
                  <th>Provider</th>
                  <th>Document check</th>
                  <th>Comparison</th>
                  <th>Submitted</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {reviews.map((review) => (
                  <StaggerItem as="tr" key={review.id}>
                    <td className="max-w-[180px] truncate font-mono text-xs text-navy-800">
                      {review.id}
                    </td>
                    <td>{review.documentType ? titleCase(review.documentType) : "—"}</td>
                    <td>
                      <StatusBadge value={review.providerStatus} fallback="Not started" />
                    </td>
                    <td>
                      <StatusBadge value={review.documentVerificationStatus} fallback="Pending" />
                    </td>
                    <td>
                      <StatusBadge value={review.dataComparisonStatus} fallback="Pending" />
                    </td>
                    <td className="whitespace-nowrap text-[13px] text-ink-500">
                      {formatDateTime(review.updatedAt)}
                    </td>
                    <td className="text-right">
                      <button type="button" className="btn-secondary py-2" onClick={() => openReview(review)}>
                        <FileSearch size={15} /> Review
                      </button>
                    </td>
                  </StaggerItem>
                ))}
              </tbody>
            </table>
          </div>
        </StaggerGroup>
      )}

      <Modal
        open={Boolean(selected)}
        onClose={closeReview}
        title="Record review decision"
        description={selected ? `Submission ${selected.id}` : ""}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={closeReview} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className={decision === "APPROVE" ? "btn-primary" : "btn-danger"}
              onClick={submit}
              disabled={busy}
            >
              {busy ? "Submitting…" : decision === "APPROVE" ? "Approve submission" : "Reject submission"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between gap-3">
              <span className="field-label">Evidence</span>
              {evidenceLoading && evidence.length > 0 ? (
                <span className="text-xs text-ink-400">Loading previews…</span>
              ) : null}
            </div>
            <div className="mt-2 space-y-3">
              {evidenceError && <Alert tone="error">{evidenceError}</Alert>}

              {!evidenceError && evidenceLoading && evidence.length === 0 && (
                <div className="flex items-center gap-2 text-sm text-ink-500" role="status">
                  <Spinner size={15} /> Loading submitted documents…
                </div>
              )}

              {!evidenceError && !evidenceLoading && evidence.length === 0 && (
                <p className="rounded-lg border border-ink-200 bg-ink-50 px-3.5 py-3 text-[13px] text-ink-500">
                  No document evidence is available for this submission.
                </p>
              )}

              {evidence.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {evidence.map((item) => (
                    <figure
                      key={item.id}
                      className="overflow-hidden rounded-lg border border-ink-200"
                    >
                      <div className="flex aspect-[3/2] items-center justify-center bg-ink-50">
                        {item.loading ? (
                          <Spinner size={18} className="text-navy-600" />
                        ) : item.url ? (
                          <img
                            src={item.url}
                            alt={`${titleCase(item.documentType)} evidence`}
                            className="h-full w-full object-contain"
                          />
                        ) : (
                          <span className="flex items-center gap-2 px-3 text-center text-xs font-semibold text-ink-500">
                            <FileImage size={16} />
                            {item.error || "Evidence unavailable"}
                          </span>
                        )}
                      </div>
                      <figcaption className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-ink-500">
                        <span className="font-semibold text-navy-900">
                          {item.documentType ? titleCase(item.documentType) : "Document"}
                          {item.side ? ` · ${titleCase(item.side)}` : ""}
                        </span>
                        <StatusBadge value={item.status} fallback="Uploaded" />
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </div>
          </div>

          <dl className="grid gap-2.5 rounded-lg bg-ink-50 p-3.5 sm:grid-cols-2">
            {checks.map((check) => (
              <div key={check.label} className="flex items-center justify-between gap-3 text-sm">
                <dt className="text-ink-500">{check.label}</dt>
                <dd>
                  <StatusBadge value={check.value} fallback={check.fallback} />
                </dd>
              </div>
            ))}
          </dl>

          {!requirementsMet && (
            <Alert tone="warning">
              Not all automated checks have passed. You can record a rejection, or ask
              the customer to resubmit after the checks complete.
            </Alert>
          )}

          <div>
            <span className="field-label">Decision</span>
            <div className="grid grid-cols-2 gap-3">
              <label
                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-3 text-sm font-semibold transition ${
                  decision === "APPROVE"
                    ? "border-navy-500 bg-navy-50 text-navy-900"
                    : "border-ink-200 text-ink-500 hover:border-navy-500/40"
                } ${!requirementsMet ? "opacity-50" : ""}`}
              >
                <input
                  type="radio"
                  name="decision"
                  value="APPROVE"
                  checked={decision === "APPROVE"}
                  onChange={() => setDecision("APPROVE")}
                  disabled={!requirementsMet || busy}
                  className="accent-navy-700"
                />
                Approve
              </label>
              <label
                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-3 text-sm font-semibold transition ${
                  decision === "REJECT"
                    ? "border-red-300 bg-red-50 text-red-800"
                    : "border-ink-200 text-ink-500 hover:border-red-300"
                }`}
              >
                <input
                  type="radio"
                  name="decision"
                  value="REJECT"
                  checked={decision === "REJECT"}
                  onChange={() => setDecision("REJECT")}
                  disabled={busy}
                  className="accent-red-700"
                />
                Reject
              </label>
            </div>
          </div>

          <div>
            <label htmlFor="reason" className="field-label">
              Reason <span className="text-red-500">*</span>
            </label>
            <textarea
              id="reason"
              className="field-input resize-y"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain the basis for this decision (5–1000 characters)."
              disabled={busy}
              aria-invalid={formError ? "true" : undefined}
            />
            <p className="mt-1.5 text-xs text-ink-400">{reason.trim().length}/1000</p>
          </div>

          {formError && <Alert tone="error">{formError}</Alert>}
        </div>
      </Modal>
    </PageTransition>
  );
}
