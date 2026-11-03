import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Gavel, Plus, ShieldAlert } from "lucide-react";
import FieldInput from "../../components/FieldInput";
import PageHeader from "../../components/ui/PageHeader";
import Alert from "../../components/ui/Alert";
import EmptyState from "../../components/ui/EmptyState";
import Modal from "../../components/ui/Modal";
import StatusBadge from "../../components/ui/StatusBadge";
import { LoadingBlock } from "../../components/ui/Spinner";
import { listMyDisputes, openDispute } from "../../services/disputesService";
import { normalizeApiError } from "../../utils/apiError";
import { formatCurrency, formatDateTime, titleCase } from "../../utils/format";

const REASON_OPTIONS = [
  { value: "UNAUTHORIZED", label: "I did not authorise this transaction" },
  { value: "DUPLICATE_CHARGE", label: "I was charged twice" },
  { value: "NOT_RECEIVED", label: "The recipient never received the money" },
  { value: "INCORRECT_AMOUNT", label: "The amount was wrong" },
  { value: "SERVICE_NOT_RECEIVED", label: "Paid but the service was not delivered" },
  { value: "OTHER", label: "Something else" },
];

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "OPEN", label: "Open" },
  { value: "UNDER_REVIEW", label: "Under review" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "REJECTED", label: "Rejected" },
];

const EMPTY_FORM = { transactionReference: "", reason: "UNAUTHORIZED", description: "" };

export default function Disputes() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [disputes, setDisputes] = useState([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Opened straight from a transaction receipt: ?transaction=<reference>
  // prefills and opens the form, and the parameter is cleared on close.
  const prefill = searchParams.get("transaction");
  const [formOpen, setFormOpen] = useState(Boolean(prefill));
  const [form, setForm] = useState(() => ({
    ...EMPTY_FORM,
    transactionReference: prefill || "",
  }));
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const closeForm = () => {
    setFormOpen(false);
    if (searchParams.has("transaction")) setSearchParams({}, { replace: true });
  };

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const data = await listMyDisputes({ status: status || undefined });
        if (!active) return;
        setDisputes(data.disputes || []);
        setError("");
      } catch (requestError) {
        if (active) setError(normalizeApiError(requestError).message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [status]);

  const setField = (key) => (event) => {
    const { value } = event.target;
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: "" }));
  };

  const submit = async (event) => {
    event.preventDefault();
    const errors = {};
    const reference = form.transactionReference.trim();
    if (!reference) errors.transactionReference = "Enter the transaction reference.";
    else if (reference.length < 36) {
      errors.transactionReference = "Use the full reference from the transaction receipt.";
    }
    const description = form.description.trim();
    if (description.length < 20) {
      errors.description = "Describe the issue in at least 20 characters.";
    } else if (description.length > 2000) {
      errors.description = "Keep the description under 2000 characters.";
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSaving(true);
    setFormError("");
    try {
      const result = await openDispute({
        transactionReference: reference,
        reason: form.reason,
        description,
      });
      setDisputes((current) => [result.dispute, ...current]);
      closeForm();
      setForm(EMPTY_FORM);
    } catch (requestError) {
      const normalized = normalizeApiError(requestError);
      setFieldErrors(normalized.fields);
      setFormError(normalized.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Account"
        title="Disputes"
        description="Raise a claim against a transaction you believe is wrong. Our financial officers review every dispute and record the outcome here."
        actions={
          <>
            <label className="flex items-center gap-2 text-[12px] font-bold text-muted">
              Status
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                className="field-input !w-auto !py-1.5 text-[12.5px]"
                aria-label="Filter disputes by status"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => setFormOpen(true)} className="btn-primary">
              <Plus size={15} /> New dispute
            </button>
          </>
        }
      />

      <Alert tone="info">
        Disputes must relate to a transaction on your wallet. Copy its reference from the{" "}
        <Link to="/transactions" className="font-bold underline underline-offset-2">
          transactions list
        </Link>
        . Funds stay as they are until the review is finished.
      </Alert>

      {error ? (
        <Alert tone="error" dismissible onDismiss={() => setError("")}>
          {error}
        </Alert>
      ) : null}

      {loading ? (
        <LoadingBlock label="Loading your disputes…" />
      ) : disputes.length === 0 ? (
        <EmptyState
          icon={Gavel}
          title={status ? "No disputes with this status" : "No disputes raised"}
          description={
            status
              ? "Switch the status filter to see your other disputes."
              : "If a transfer, deposit or payment looks wrong, open a dispute and we will investigate."
          }
          actionLabel={status ? "Show all statuses" : "New dispute"}
          onAction={status ? () => setStatus("") : () => setFormOpen(true)}
        />
      ) : (
        <ul className="space-y-3">
          {disputes.map((dispute) => (
            <li key={dispute.id} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to={`/disputes/${dispute.reference}`}
                      className="text-[15px] font-extrabold text-brand-700 hover:underline"
                    >
                      {titleCase(dispute.reason)}
                    </Link>
                    <StatusBadge value={dispute.status} />
                  </div>
                  <p className="mt-1 text-[12px] text-muted">
                    Reference <span className="font-mono">{dispute.reference.slice(0, 8)}</span> ·
                    opened {formatDateTime(dispute.openedAt)}
                  </p>
                  <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-body">
                    {dispute.description}
                  </p>
                </div>
                <div className="text-right">
                  {dispute.transaction ? (
                    <>
                      <p className="num text-[15px] font-extrabold text-midnight">
                        {formatCurrency(dispute.transaction.amount, dispute.transaction.currency)}
                      </p>
                      <p className="mt-0.5 text-[11.5px] text-muted">
                        {titleCase(dispute.transaction.type)}{" "}
                        {dispute.transaction.status === "POSTED" ? "· posted" : ""}
                      </p>
                    </>
                  ) : null}
                  <Link
                    to={`/disputes/${dispute.reference}`}
                    className="mt-2 inline-block text-[12px] font-bold text-brand-700 hover:underline"
                  >
                    Open case <ShieldAlert size={12} className="ml-0.5 inline" />
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={formOpen}
        onClose={saving ? undefined : closeForm}
        title="Raise a dispute"
        description="Tell us which transaction is wrong and what happened. A financial officer reviews the ledger entry and replies with the outcome."
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={closeForm} disabled={saving}>
              Cancel
            </button>
            <button type="submit" form="dispute-form" className="btn-primary" disabled={saving}>
              {saving ? "Submitting…" : "Submit dispute"}
            </button>
          </>
        }
      >
        <form id="dispute-form" onSubmit={submit} className="space-y-4" noValidate>
          {formError ? <Alert tone="error">{formError}</Alert> : null}
          <FieldInput
            label="Transaction reference"
            name="transactionReference"
            value={form.transactionReference}
            onChange={setField("transactionReference")}
            error={fieldErrors.transactionReference}
            hint="The full UUID shown on the transaction receipt."
            placeholder="00000000-0000-0000-0000-000000000000"
            required
          />
          <FieldInput
            label="Reason"
            name="reason"
            value={form.reason}
            onChange={setField("reason")}
            options={REASON_OPTIONS}
            error={fieldErrors.reason}
          />
          <FieldInput
            label="What happened?"
            name="description"
            value={form.description}
            onChange={setField("description")}
            error={fieldErrors.description}
            hint={`${form.description.trim().length}/2000 characters · minimum 20`}
            rows={5}
            required
          />
        </form>
      </Modal>
    </div>
  );
}
