import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CircleDot } from "lucide-react";
import FieldInput from "../../components/FieldInput";
import PageHeader from "../../components/ui/PageHeader";
import Alert from "../../components/ui/Alert";
import StatusBadge from "../../components/ui/StatusBadge";
import { LoadingBlock } from "../../components/ui/Spinner";
import { getDisputeForStaff, updateDispute } from "../../services/disputesService";
import { normalizeApiError } from "../../utils/apiError";
import { formatCurrency, formatDateTime, titleCase } from "../../utils/format";

const TRANSITIONS = {
  OPEN: ["UNDER_REVIEW", "RESOLVED", "REJECTED"],
  UNDER_REVIEW: ["RESOLVED", "REJECTED"],
  RESOLVED: [],
  REJECTED: [],
};

const STATUS_LABELS = {
  UNDER_REVIEW: "Start review",
  RESOLVED: "Resolve",
  REJECTED: "Reject",
};

const AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,16})(?:\.\d{1,2})?$/;

export default function FinanceDisputeDetail() {
  const { reference } = useParams();
  const [dispute, setDispute] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [form, setForm] = useState({
    status: "",
    resolution: "",
    assignedTo: "",
    resolvedAmount: "",
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const data = await getDisputeForStaff(reference);
        if (!active) return;
        setDispute(data.dispute);
        setForm((current) => ({
          ...current,
          status: (TRANSITIONS[data.dispute.status] || [])[0] || "",
          assignedTo: data.dispute.assignedTo || "",
        }));
        setLoadError("");
      } catch (requestError) {
        if (active) setLoadError(normalizeApiError(requestError).message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [reference]);

  if (loading) return <LoadingBlock label="Loading dispute case…" />;
  if (loadError || !dispute) {
    return (
      <div className="space-y-4">
        <Alert tone="error">{loadError || "Dispute not found."}</Alert>
        <Link to="/finance/disputes" className="btn-ghost">
          Back to queue
        </Link>
      </div>
    );
  }

  const options = TRANSITIONS[dispute.status] || [];
  const closing = form.status === "RESOLVED" || form.status === "REJECTED";

  const setField = (key) => (event) => {
    const { value } = event.target;
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: "" }));
    setNotice("");
  };

  const submit = async (event) => {
    event.preventDefault();
    const errors = {};
    if (!form.status) errors.status = "Choose the next status.";
    if (closing && form.resolution.trim().length < 1) {
      errors.resolution = "Record the reason for this decision.";
    }
    if (form.resolvedAmount && !AMOUNT_PATTERN.test(form.resolvedAmount)) {
      errors.resolvedAmount = "Enter a decimal amount with at most two places.";
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSaving(true);
    setFormError("");
    try {
      const payload = { status: form.status };
      if (form.resolution.trim()) payload.resolution = form.resolution.trim();
      if (form.assignedTo.trim()) payload.assignedTo = form.assignedTo.trim();
      if (form.resolvedAmount) payload.resolvedAmount = form.resolvedAmount;
      const result = await updateDispute(dispute.reference, payload);
      setDispute(result.dispute);
      setForm({
        status: (TRANSITIONS[result.dispute.status] || [])[0] || "",
        resolution: "",
        assignedTo: result.dispute.assignedTo || "",
        resolvedAmount: "",
      });
      setNotice(`Case updated to ${titleCase(result.dispute.status)}. The customer was notified.`);
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
        backTo="/finance/disputes"
        backLabel="Dispute queue"
        eyebrow="Finance · dispute case"
        title={titleCase(dispute.reason)}
        description={`Reference ${dispute.reference} · opened ${formatDateTime(dispute.openedAt)} · last update ${formatDateTime(dispute.updatedAt)}`}
        actions={<StatusBadge value={dispute.status} />}
      />

      {notice ? (
        <Alert tone="success" dismissible onDismiss={() => setNotice("")}>
          {notice}
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section className="space-y-4">
          <div className="card p-5 sm:p-6">
            <h2 className="text-[15px] font-extrabold text-midnight">Customer statement</h2>
            <p className="mt-2 whitespace-pre-line text-[13.5px] leading-relaxed text-body">
              {dispute.description}
            </p>
            {dispute.resolution ? (
              <>
                <h2 className="mt-5 text-[15px] font-extrabold text-midnight">Recorded decision</h2>
                <p className="mt-2 rounded-lg border border-ink-200 bg-ink-50 p-4 text-[13.5px] leading-relaxed text-body">
                  {dispute.resolution}
                  {dispute.resolvedAmount ? (
                    <span className="mt-1 block font-bold text-midnight">
                      Resolved amount:{" "}
                      {formatCurrency(dispute.resolvedAmount, dispute.transaction?.currency)}
                    </span>
                  ) : null}
                </p>
              </>
            ) : null}
          </div>

          <div className="card p-5 sm:p-6">
            <h2 className="text-[15px] font-extrabold text-midnight">Case history</h2>
            <ol className="mt-3 space-y-3">
              {(dispute.events || []).map((event) => (
                <li key={event.id} className="flex gap-3">
                  <CircleDot size={14} className="mt-1 shrink-0 text-brand-600" />
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-bold text-midnight">
                      {titleCase(event.type.replace(/^STATUS_/, ""))}
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-muted">
                      {formatDateTime(event.createdAt)}
                      {event.actorUserId ? ` · staff ${event.actorUserId.slice(0, 8)}` : ""}
                    </p>
                    {event.note ? (
                      <p className="mt-1 text-[12.5px] leading-relaxed text-body">{event.note}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="space-y-4">
          <div className="card p-5">
            <h2 className="text-[13px] font-extrabold text-midnight">Customer</h2>
            <p className="mt-2 text-[13px] font-bold text-midnight">
              {dispute.customer?.name || "—"}
            </p>
            <p className="text-[12px] text-muted">{dispute.customer?.email || "—"}</p>
          </div>

          <div className="card p-5">
            <h2 className="text-[13px] font-extrabold text-midnight">Disputed transaction</h2>
            {dispute.transaction ? (
              <dl className="mt-3 space-y-2 text-[12.5px]">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted">Amount</dt>
                  <dd className="num font-extrabold text-midnight">
                    {formatCurrency(dispute.transaction.amount, dispute.transaction.currency)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted">Type</dt>
                  <dd className="font-semibold text-body">{titleCase(dispute.transaction.type)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted">Ledger status</dt>
                  <dd>
                    <StatusBadge value={dispute.transaction.status} />
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted">Posted</dt>
                  <dd className="font-semibold text-body">
                    {formatDateTime(dispute.transaction.createdAt)}
                  </dd>
                </div>
              </dl>
            ) : null}
            <Link
              to={`/finance/transactions/${dispute.transaction?.reference}`}
              className="link mt-3 inline-flex text-[12.5px] font-bold"
            >
              Open reconciliation view
            </Link>
          </div>

          <form onSubmit={submit} className="card space-y-4 p-5" noValidate>
            <div>
              <h2 className="text-[13px] font-extrabold text-midnight">Record a decision</h2>
              <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
                The customer receives a notification for every status change. Reversing funds is a
                separate ledger action and is not performed here.
              </p>
            </div>

            {formError ? <Alert tone="error">{formError}</Alert> : null}

            {options.length === 0 ? (
              <Alert tone="info">
                This case is {titleCase(dispute.status).toLowerCase()} and can no longer be changed.
              </Alert>
            ) : (
              <>
                <FieldInput
                  label="New status"
                  name="status"
                  value={form.status}
                  onChange={setField("status")}
                  error={fieldErrors.status}
                  options={options.map((value) => ({
                    value,
                    label: STATUS_LABELS[value] || titleCase(value),
                  }))}
                  required
                />
                <FieldInput
                  label="Assigned to"
                  name="assignedTo"
                  value={form.assignedTo}
                  onChange={setField("assignedTo")}
                  error={fieldErrors.assignedTo}
                  placeholder="Officer name or team"
                />
                <FieldInput
                  label={closing ? "Decision note" : "Internal note"}
                  name="resolution"
                  value={form.resolution}
                  onChange={setField("resolution")}
                  error={fieldErrors.resolution}
                  hint={
                    closing
                      ? "Shown to the customer as the outcome of the review."
                      : "Optional while the case is still open."
                  }
                  rows={4}
                  required={closing}
                />
                {form.status === "RESOLVED" ? (
                  <FieldInput
                    label="Resolved amount (optional)"
                    name="resolvedAmount"
                    value={form.resolvedAmount}
                    onChange={setField("resolvedAmount")}
                    error={fieldErrors.resolvedAmount}
                    hint={`Record the amount agreed with the customer. Maximum ${formatCurrency(
                      dispute.transaction?.amount,
                      dispute.transaction?.currency
                    )}.`}
                    placeholder="0.00"
                  />
                ) : null}
                <button
                  type="submit"
                  disabled={saving || !form.status}
                  className="btn-primary w-full justify-center"
                >
                  {saving ? "Saving…" : STATUS_LABELS[form.status] || "Update case"}
                </button>
              </>
            )}
          </form>
        </section>
      </div>
    </div>
  );
}
