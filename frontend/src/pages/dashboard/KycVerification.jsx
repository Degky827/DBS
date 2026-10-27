import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowUpRight, FileCheck2, Trash2, UploadCloud } from "lucide-react";
import {
  compareKycProfile,
  correctKycDocumentFields,
  createKycSubmission,
  deleteKycDocument,
  getKycDocument,
  getKycDocumentContent,
  getKycStatus,
  recallKycDocumentId,
  rememberKycDocumentId,
  startVerificationSession,
  uploadKycDocument,
} from "../../services/kycService";
import { normalizeApiError } from "../../utils/apiError";
import { formatBytes, formatDate, titleCase } from "../../utils/format";
import PageTransition, { StaggerGroup, StaggerItem } from "../../components/ui/PageTransition";
import PageHeader from "../../components/ui/PageHeader";
import Alert from "../../components/ui/Alert";
import StatusBadge from "../../components/ui/StatusBadge";
import EmptyState from "../../components/ui/EmptyState";
import { ConfirmDialog } from "../../components/ui/Modal";
import { Spinner } from "../../components/ui/Spinner";

const DOCUMENT_OPTIONS = [
  { value: "passport", label: "Passport" },
  { value: "national_id", label: "National ID" },
  { value: "drivers_license", label: "Driver's licence" },
  { value: "residence_permit", label: "Residence permit" },
];

const SIDE_OPTIONS = [
  { value: "front", label: "Front" },
  { value: "back", label: "Back" },
];

const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;
const EDITABLE_STATUSES = ["DRAFT", "NEEDS_RESUBMISSION"];

export default function KycVerification() {
  const [submission, setSubmission] = useState(null);
  const [checking, setChecking] = useState(true);
  const [notStarted, setNotStarted] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState(null);

  const [documentType, setDocumentType] = useState("national_id");
  const [side, setSide] = useState("front");
  const [file, setFile] = useState(null);
  const fileInputRef = useRef(null);

  const [document, setDocument] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [fieldDrafts, setFieldDrafts] = useState({});
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [compareResult, setCompareResult] = useState(null);
  const [sessionUrl, setSessionUrl] = useState("");

  const loadDocument = useCallback(async (submissionId, documentId) => {
    if (!documentId) {
      setDocument(null);
      return;
    }
    try {
      const loaded = await getKycDocument(documentId);
      setDocument(loaded);
      const drafts = {};
      for (const field of loaded?.extractedData?.fields || []) {
        drafts[field.key] = field.correctedValue ?? field.value ?? "";
      }
      setFieldDrafts(drafts);
      const preview = await getKycDocumentContent(documentId);
      setPreviewUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return preview.url;
      });
    } catch {
      rememberKycDocumentId(submissionId, null);
      setDocument(null);
    }
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const current = await getKycStatus();
      setSubmission(current);
      setNotStarted(false);
      setLoadError("");
      if (Array.isArray(current?.comparisonResults) && current.comparisonResults.length > 0) {
        setCompareResult({
          status: current.dataComparisonStatus,
          fields: current.comparisonResults,
        });
      }
      await loadDocument(current.id, recallKycDocumentId(current.id));
    } catch (error) {
      const { status } = normalizeApiError(error);
      if (status === 404) {
        setSubmission(null);
        setNotStarted(true);
        setDocument(null);
      } else {
        setLoadError("We could not load your verification status. Please try again.");
      }
    } finally {
      setChecking(false);
    }
  }, [loadDocument]);

  const refreshStatus = () => {
    setChecking(true);
    loadStatus();
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const current = await getKycStatus();
        if (!mounted) return;
        setSubmission(current);
        setNotStarted(false);
        setLoadError("");
        if (Array.isArray(current?.comparisonResults) && current.comparisonResults.length > 0) {
          setCompareResult({
            status: current.dataComparisonStatus,
            fields: current.comparisonResults,
          });
        }
        await loadDocument(current.id, recallKycDocumentId(current.id));
      } catch (error) {
        if (!mounted) return;
        const { status } = normalizeApiError(error);
        if (status === 404) {
          setSubmission(null);
          setNotStarted(true);
          setDocument(null);
        } else {
          setLoadError("We could not load your verification status. Please try again.");
        }
      } finally {
        if (mounted) setChecking(false);
      }
    })();
    return () => {
      mounted = false;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (action, { successMessage } = {}) => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await action();
      if (successMessage) setNotice({ tone: "success", message: successMessage });
      return result;
    } catch (error) {
      const { message } = normalizeApiError(error);
      setNotice({ tone: "error", message });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const handleCreateSubmission = () =>
    run(async () => {
      await createKycSubmission();
      await loadStatus();
      setNotice({ tone: "success", message: "Your verification submission was created." });
    });

  const handleUpload = async (event) => {
    event.preventDefault();
    if (!submission?.id || !file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setNotice({ tone: "error", message: "Choose a JPG, PNG, or WebP image." });
      return;
    }
    if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
      setNotice({ tone: "error", message: "Choose an image that is 10 MB or smaller." });
      return;
    }

    await run(async () => {
      const uploaded = await uploadKycDocument({
        submissionId: submission.id,
        documentType,
        side,
        file,
      });
      rememberKycDocumentId(submission.id, uploaded.id);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setNotice({ tone: "success", message: "Document uploaded and processed with OCR." });
      await loadStatus();
      await loadDocument(submission.id, uploaded.id);
    });
  };

  const handleSaveCorrections = async () => {
    if (!document?.id) return;
    const fields = (document.extractedData?.fields || [])
      .map((field) => ({
        key: field.key,
        value: (fieldDrafts[field.key] ?? "").trim(),
      }))
      .filter((field) => field.value.length > 0);

    if (fields.length === 0) {
      setNotice({ tone: "error", message: "Provide at least one corrected field." });
      return;
    }

    await run(async () => {
      const updated = await correctKycDocumentFields(document.id, fields);
      setDocument(updated);
      setNotice({ tone: "success", message: "Extracted fields updated." });
    });
  };

  const handleDeleteDocument = async () => {
    if (!document?.id || !submission?.id) return;
    await run(async () => {
      await deleteKycDocument(document.id);
      rememberKycDocumentId(submission.id, null);
      setDocument(null);
      setPreviewUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return "";
      });
      setFieldDrafts({});
      setConfirmDelete(false);
      setNotice({ tone: "success", message: "Document deleted. You can upload a new one." });
      await loadStatus();
    });
  };

  const handleCompare = async () => {
    if (!submission?.id) return;
    await run(async () => {
      const result = await compareKycProfile(submission.id);
      setCompareResult(result);
      setNotice({
        tone: result?.status === "MATCH" ? "success" : "warning",
        message:
          result?.status === "MATCH"
            ? "Your profile data matches the document."
            : "Some fields need attention before approval.",
      });
      await loadStatus();
    });
  };

  const handleStartSession = async () => {
    if (!submission?.id) return;
    await run(async () => {
      const result = await startVerificationSession(submission.id);
      setSessionUrl(result.sessionUrl || "");
      setNotice({
        tone: "success",
        message: result.reused
          ? "Your existing verification session was reused."
          : "Verification session created.",
      });
      await loadStatus();
    });
  };

  const editable = submission && EDITABLE_STATUSES.includes(submission.status);
  const checks = submission
    ? [
        { label: "Provider check", value: submission.providerStatus, fallback: "Not started" },
        {
          label: "Document verification",
          value: submission.documentVerificationStatus,
          fallback: "Pending",
        },
        { label: "Data comparison", value: submission.dataComparisonStatus, fallback: "Pending" },
        { label: "Face match", value: submission.faceMatchStatus, fallback: "Pending" },
        { label: "Liveness", value: submission.livenessStatus, fallback: "Pending" },
      ]
    : [];

  return (
    <PageTransition className="space-y-6">
      <PageHeader
        eyebrow="Identity verification"
        title="KYC verification"
        description="Upload an identity document, review the extracted data and complete the secure provider check. Documents are encrypted at rest."
      />

      <Alert tone={notice?.tone || "info"} dismissible onDismiss={() => setNotice(null)}>
        {notice?.message}
      </Alert>

      {loadError && <Alert tone="error">{loadError}</Alert>}

      {checking ? (
        <div className="card flex items-center justify-center gap-3 px-5 py-16 text-sm font-semibold text-ink-500" role="status">
          <Spinner className="text-navy-600" /> Loading your verification status…
        </div>
      ) : notStarted ? (
        <EmptyState
          icon={FileCheck2}
          title="Start your identity verification"
          description="Create a verification submission, then upload a government-issued ID and complete the secure provider check."
          actionLabel="Start verification"
          onAction={handleCreateSubmission}
        />
      ) : (
        <>
          <StaggerGroup className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <StaggerItem className="card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-400">
                    Current status
                  </p>
                  <h2 className="mt-1 text-xl font-extrabold text-navy-900">
                    {titleCase(submission?.status)}
                  </h2>
                  <p className="mt-1 text-xs text-ink-400">
                    Submission {submission?.id} · Created {formatDate(submission?.createdAt)}
                  </p>
                </div>
                <StatusBadge value={submission?.status} />
              </div>

              <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                {checks.map((check) => (
                  <div
                    key={check.label}
                    className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2.5"
                  >
                    <dt className="text-[13px] text-ink-500">{check.label}</dt>
                    <dd>
                      <StatusBadge value={check.value} fallback={check.fallback} />
                    </dd>
                  </div>
                ))}
              </dl>

              <div className="mt-5 flex flex-wrap gap-3 border-t border-ink-100 pt-4">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleStartSession}
                  disabled={busy || !editable}
                  title={editable ? undefined : "Sessions can be started while the submission is editable"}
                >
                  {busy ? <Spinner size={16} /> : <FileCheck2 size={16} />}
                  Start provider session
                </button>
                <button type="button" className="btn-ghost" onClick={handleCompare} disabled={busy}>
                  Compare with profile
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={refreshStatus}
                  disabled={busy || checking}
                >
                  Refresh status
                </button>
              </div>

              {sessionUrl && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-navy-100 bg-navy-50 px-4 py-3">
                  <p className="text-[13px] font-medium text-navy-700">
                    Your secure verification session is ready.
                  </p>
                  <a
                    href={sessionUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-bold text-navy-800 underline-offset-4 hover:underline"
                  >
                    Open session <ArrowUpRight size={14} />
                  </a>
                </div>
              )}

              {compareResult?.fields?.length > 0 && (
                <div className="mt-4 border-t border-ink-100 pt-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-400">
                      Profile comparison
                    </p>
                    <StatusBadge value={compareResult.status} />
                  </div>
                  <ul className="mt-3 space-y-2">
                    {compareResult.fields.map((field) => (
                      <li
                        key={field.field}
                        className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2 text-sm"
                      >
                        <span className="font-semibold text-navy-900">{titleCase(field.field)}</span>
                        <StatusBadge value={field.status} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </StaggerItem>

            <StaggerItem className="card p-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-400">
                How it works
              </p>
              <ol className="mt-4 space-y-3 text-sm leading-relaxed text-ink-500">
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy-800 text-[11px] font-bold text-white">1</span>
                  Upload a clear photo of an accepted government ID. The file is
                  normalized and encrypted before storage.
                </li>
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy-800 text-[11px] font-bold text-white">2</span>
                  Review the OCR output and correct any field that was misread, then
                  compare it with your profile.
                </li>
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy-800 text-[11px] font-bold text-white">3</span>
                  Complete the provider session for face and liveness checks. A review
                  officer records the final decision.
                </li>
              </ol>
            </StaggerItem>
          </StaggerGroup>

          <div className="card p-5">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-gold-100 text-gold-600">
                <UploadCloud size={18} />
              </span>
              <div>
                <h2 className="text-lg font-extrabold text-navy-900">Identity document</h2>
                <p className="text-sm text-ink-500">
                  {editable
                    ? "Accepted: JPG, PNG or WebP up to 10 MB."
                    : "Documents can only be replaced while the submission is editable."}
                </p>
              </div>
            </div>

            <form onSubmit={handleUpload} className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="field-label">Document type</span>
                <select
                  className="field-input"
                  value={documentType}
                  onChange={(e) => setDocumentType(e.target.value)}
                  disabled={!editable || busy}
                >
                  {DOCUMENT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2">
                <span className="field-label">Document side</span>
                <select
                  className="field-input"
                  value={side}
                  onChange={(e) => setSide(e.target.value)}
                  disabled={!editable || busy}
                >
                  {SIDE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="md:col-span-2">
                <label className="space-y-2">
                  <span className="field-label">Choose file</span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="field-input cursor-pointer"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    disabled={!editable || busy}
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-3 md:col-span-2">
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={!editable || !file || busy}
                >
                  {busy ? <Spinner size={16} /> : <UploadCloud size={16} />} Upload document
                </button>
              </div>
            </form>
          </div>

          {document && (
            <div className="card p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-400">
                    Uploaded document
                  </p>
                  <h2 className="mt-1 text-lg font-extrabold text-navy-900">
                    OCR review and corrections
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge value={document.status} />
                  {editable && (
                    <button
                      type="button"
                      className="btn-danger-outline"
                      onClick={() => setConfirmDelete(true)}
                      disabled={busy}
                    >
                      <Trash2 size={15} /> Delete
                    </button>
                  )}
                </div>
              </div>

              <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
                {previewUrl ? (
                  <div className="overflow-hidden rounded-xl border border-ink-100 bg-ink-50">
                    <img
                      src={previewUrl}
                      alt="Uploaded identity document"
                      className="max-h-[420px] w-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="flex min-h-[220px] items-center justify-center rounded-xl border border-dashed border-ink-200 bg-ink-50 text-sm text-ink-400">
                    Preview unavailable
                  </div>
                )}

                <div className="space-y-4">
                  <div className="rounded-xl bg-ink-50 p-3">
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-400">
                      Document details
                    </p>
                    <dl className="mt-3 space-y-2 text-sm">
                      {[
                        ["Type", titleCase(document.documentType)],
                        ["Side", document.side ? titleCase(document.side) : "—"],
                        ["Size", formatBytes(document.fileSizeBytes)],
                        [
                          "OCR confidence",
                          Number.isFinite(document.ocrConfidence)
                            ? `${document.ocrConfidence.toFixed(1)}%`
                            : "—",
                        ],
                      ].map(([label, value]) => (
                        <div key={label} className="flex justify-between gap-3">
                          <dt className="text-ink-500">{label}</dt>
                          <dd className="font-bold text-navy-900">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>

                  {document.ocrText && (
                    <details className="rounded-xl bg-ink-50 p-3">
                      <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-[0.14em] text-ink-400">
                        Detected text
                      </summary>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-navy-900">
                        {document.ocrText}
                      </p>
                    </details>
                  )}
                </div>
              </div>

              {document.extractedData?.fields?.length > 0 && (
                <div className="mt-5 border-t border-ink-100 pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-400">
                      Extracted fields
                    </p>
                    {editable && (
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={handleSaveCorrections}
                        disabled={busy}
                      >
                        {busy ? <Spinner size={15} /> : null} Save corrections
                      </button>
                    )}
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {document.extractedData.fields.map((field) => (
                      <label key={field.key} className="block">
                        <span className="field-label">
                          {field.label || field.key}
                          {field.needsCorrection ? (
                            <span className="ml-1 normal-case tracking-normal text-amber-600">
                              · needs review
                            </span>
                          ) : null}
                        </span>
                        <input
                          className="field-input"
                          value={fieldDrafts[field.key] ?? ""}
                          onChange={(e) =>
                            setFieldDrafts((prev) => ({ ...prev, [field.key]: e.target.value }))
                          }
                          disabled={!editable || busy}
                        />
                      </label>
                    ))}
                  </div>
                  {document.extractedData?.correctedAt && (
                    <p className="mt-3 text-xs text-ink-400">
                      Last corrected {formatDate(document.extractedData.correctedAt)}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDeleteDocument}
        title="Delete this document?"
        description="The stored file and its OCR data will be removed. You can upload a new document afterwards."
        confirmLabel="Delete document"
        busy={busy}
      >
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-[13px] font-medium text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          This action cannot be undone.
        </div>
      </ConfirmDialog>
    </PageTransition>
  );
}
