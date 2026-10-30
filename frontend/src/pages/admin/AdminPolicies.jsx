import { useEffect, useState } from "react";
import { Pencil, Scale, ShieldCheck } from "lucide-react";
import { getFinancialPolicies, updateFinancialPolicy } from "../../services/staffService";
import { normalizeApiError } from "../../utils/apiError";
import { formatCurrency, formatDateTime, titleCase } from "../../utils/format";
import PageHeader from "../../components/ui/PageHeader";
import Alert from "../../components/ui/Alert";
import Modal, { ConfirmDialog } from "../../components/ui/Modal";
import EmptyState from "../../components/ui/EmptyState";
import { Spinner } from "../../components/ui/Spinner";

const FEE_TYPES = ["NONE", "FLAT", "PERCENTAGE", "FLAT_PLUS_PERCENTAGE"];

const AMOUNT_FIELDS = [
  ["minAmount", "Minimum amount"],
  ["maxAmount", "Maximum amount"],
  ["dailyOutgoingAmount", "Daily outgoing amount"],
  ["feeFlat", "Flat fee"],
  ["feeMin", "Minimum fee"],
  ["feeMax", "Maximum fee (optional)"],
];

const formFromPolicy = (policy) => ({
  minAmount: policy.minAmount,
  maxAmount: policy.maxAmount,
  dailyOutgoingAmount: policy.dailyOutgoingAmount,
  dailyOutgoingCount: String(policy.dailyOutgoingCount),
  feeType: policy.feeType,
  feeFlat: policy.feeFlat,
  feeMin: policy.feeMin,
  feeMax: policy.feeMax ?? "",
  feeBps: String(policy.feeBps),
  timezone: policy.timezone,
  reason: "",
});

const isAmount = (value) => /^\d+(\.\d{1,2})?$/.test(value);

const feeSummary = (policy) => {
  if (policy.feeType === "NONE") return "No fee";
  const parts = [];
  if (policy.feeType === "FLAT" || policy.feeType === "FLAT_PLUS_PERCENTAGE") {
    parts.push(`${formatCurrency(policy.feeFlat, policy.currency)} flat`);
  }
  if (
    policy.feeType === "PERCENTAGE" ||
    policy.feeType === "FLAT_PLUS_PERCENTAGE"
  ) {
    parts.push(`${(policy.feeBps / 100).toFixed(2)}%`);
  }
  const bounds = [];
  if (Number(policy.feeMin) > 0) bounds.push(`min ${formatCurrency(policy.feeMin, policy.currency)}`);
  if (policy.feeMax !== null) bounds.push(`max ${formatCurrency(policy.feeMax, policy.currency)}`);
  return bounds.length ? `${parts.join(" + ")} (${bounds.join(", ")})` : parts.join(" + ");
};

const validateForm = (form) => {
  const errors = {};
  for (const [field, label] of AMOUNT_FIELDS) {
    if (field === "feeMax" && form.feeMax === "") continue;
    if (!isAmount(form[field])) {
      errors[field] = `${label} must be a positive amount with up to two decimals`;
    }
  }
  const count = Number(form.dailyOutgoingCount);
  if (!Number.isInteger(count) || count < 0 || count > 100000) {
    errors.dailyOutgoingCount = "Daily count must be a whole number from 0 to 100000";
  }
  const bps = Number(form.feeBps);
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) {
    errors.feeBps = "Fee percentage must be a whole number of basis points (0–10000)";
  }
  if (!FEE_TYPES.includes(form.feeType)) {
    errors.feeType = "Choose a supported fee type";
  }
  if (!form.timezone.trim()) {
    errors.timezone = "Timezone is required";
  }
  if (form.reason.trim().length < 10) {
    errors.reason = "Describe why this change is being made (at least 10 characters)";
  }
  return errors;
};

const buildChanges = (policy, form) => {
  const changes = [];
  const moneyFields = new Set(["minAmount", "maxAmount", "dailyOutgoingAmount", "feeFlat", "feeMin", "feeMax"]);
  for (const [field, label] of AMOUNT_FIELDS) {
    const next = field === "feeMax" ? form.feeMax || null : form[field];
    const before = field === "feeMax" ? policy.feeMax : policy[field];
    if (String(next) === String(before)) continue;
    const present = (value) =>
      value === null ? "Not set" : moneyFields.has(field) ? formatCurrency(value, policy.currency) : value;
    changes.push({ field, label, from: present(before), to: present(next) });
  }
  const count = String(Number(form.dailyOutgoingCount));
  if (count !== String(policy.dailyOutgoingCount)) {
    changes.push({
      field: "dailyOutgoingCount",
      label: "Daily outgoing count",
      from: policy.dailyOutgoingCount,
      to: count,
    });
  }
  if (form.feeType !== policy.feeType) {
    changes.push({
      field: "feeType",
      label: "Fee type",
      from: titleCase(policy.feeType),
      to: titleCase(form.feeType),
    });
  }
  const bps = String(Number(form.feeBps));
  if (bps !== String(policy.feeBps)) {
    changes.push({ field: "feeBps", label: "Fee basis points", from: policy.feeBps, to: bps });
  }
  if (form.timezone.trim() !== policy.timezone) {
    changes.push({
      field: "timezone",
      label: "Timezone",
      from: policy.timezone,
      to: form.timezone.trim(),
    });
  }
  return changes;
};

const payloadFor = (policy, form, changes) => {
  const payload = { currency: policy.currency, reason: form.reason.trim() };
  for (const { field } of changes) {
    if (field === "feeMax") payload.feeMax = form.feeMax || null;
    else if (field === "dailyOutgoingCount") payload.dailyOutgoingCount = Number(form.dailyOutgoingCount);
    else if (field === "feeBps") payload.feeBps = Number(form.feeBps);
    else if (field === "timezone") payload.timezone = form.timezone.trim();
    else payload[field] = form[field];
  }
  return payload;
};

export default function AdminPolicies() {
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [reviewing, setReviewing] = useState(false);
  const [changes, setChanges] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await getFinancialPolicies();
      setPolicies(data.policies);
      setError("");
    } catch (requestError) {
      setError(normalizeApiError(requestError).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await getFinancialPolicies();
        if (!active) return;
        setPolicies(data.policies);
        setError("");
      } catch (requestError) {
        if (!active) return;
        setError(normalizeApiError(requestError).message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const openEditor = (policy) => {
    setEditing(policy);
    setForm(formFromPolicy(policy));
    setFieldErrors({});
    setReviewing(false);
    setChanges([]);
    setSaveError("");
  };

  const closeEditor = () => {
    setEditing(null);
    setForm(null);
    setReviewing(false);
    setChanges([]);
    setSaveError("");
    setConfirmClose(false);
  };

  const requestClose = () => {
    if (saving) return;
    if (form?.reason || reviewing) {
      setConfirmClose(true);
      return;
    }
    closeEditor();
  };

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors({});
  };

  const proceedToReview = (event) => {
    event.preventDefault();
    const errors = validateForm(form);
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;
    const diff = buildChanges(editing, form);
    if (!diff.length) {
      setFieldErrors({ _form: "Change at least one policy value before saving." });
      return;
    }
    setChanges(diff);
    setReviewing(true);
  };

  const save = async () => {
    if (!editing || !form) return;
    setSaving(true);
    setSaveError("");
    try {
      const data = await updateFinancialPolicy(
        editing.type,
        payloadFor(editing, form, changes)
      );
      setPolicies((current) =>
        current.map((policy) => (policy.id === data.policy.id ? data.policy : policy))
      );
      setNotice(
        `${titleCase(data.policy.type)} policy updated. The change was recorded in the policy revision history.`
      );
      closeEditor();
    } catch (requestError) {
      const normalized = normalizeApiError(requestError);
      setSaveError(normalized.message);
      if (normalized.fieldErrors) setFieldErrors(normalized.fieldErrors);
      setReviewing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Financial policies"
        description="Transfer, deposit and withdrawal limits and fees. Every change requires a reason and is written to the policy revision history used by the audit records page."
        actions={
          <button type="button" className="btn-ghost" onClick={load} disabled={loading}>
            Refresh
          </button>
        }
      />

      <Alert tone="info">
        Policies apply to new transactions only. Existing posted transactions keep the limits
        and fees that were applied when they were created.
      </Alert>

      {notice ? (
        <Alert tone="success" dismissible onDismiss={() => setNotice("")}>
          {notice}
        </Alert>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      <section className="card overflow-hidden">
        <div className="border-b border-ink-100 px-5 py-4">
          <h2 className="text-[15px] font-extrabold text-midnight">Configured policies</h2>
          <p className="mt-0.5 text-[12px] text-muted">
            {loading
              ? "Loading policies"
              : `${policies.length} policy record${policies.length === 1 ? "" : "s"}`}
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 px-5 py-16 text-[13px] font-semibold text-ink-500">
            <Spinner size={16} className="text-brand-600" /> Loading policies…
          </div>
        ) : policies.length === 0 ? (
          <EmptyState
            icon={Scale}
            title="No policies configured"
            description="Limits and fees are seeded by the platform administrator. Nothing can be edited until a policy record exists."
            className="border-0 shadow-none"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Policy</th>
                  <th>Amount range</th>
                  <th>Daily limits</th>
                  <th>Fees</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {policies.map((policy) => (
                  <tr key={policy.id}>
                    <td>
                      <p className="font-semibold text-midnight">{titleCase(policy.type)}</p>
                      <p className="text-[12px] text-muted">
                        {policy.currency} · {policy.isActive ? "Active" : "Inactive"}
                      </p>
                    </td>
                    <td className="num whitespace-nowrap text-[12.5px]">
                      {formatCurrency(policy.minAmount, policy.currency)} –{" "}
                      {formatCurrency(policy.maxAmount, policy.currency)}
                    </td>
                    <td className="text-[12.5px]">
                      <p className="num">
                        {formatCurrency(policy.dailyOutgoingAmount, policy.currency)}
                      </p>
                      <p className="text-[11.5px] text-muted">
                        {policy.dailyOutgoingCount} transactions / day
                      </p>
                    </td>
                    <td className="text-[12.5px]">{feeSummary(policy)}</td>
                    <td className="whitespace-nowrap text-[12px] text-muted">
                      {formatDateTime(policy.updatedAt)}
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="link inline-flex items-center gap-1.5 text-[12px]"
                        onClick={() => openEditor(policy)}
                        disabled={!policy.isActive}
                      >
                        <Pencil size={13} /> Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal
        open={Boolean(editing && form)}
        onClose={requestClose}
        title={reviewing ? "Review policy change" : `Edit ${titleCase(editing?.type)} policy`}
        description={
          reviewing
            ? "Confirm the exact values that will apply to new transactions."
            : "Amounts use two decimal places. The change is applied immediately after confirmation."
        }
        size="lg"
        footer={
          reviewing ? (
            <>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setReviewing(false)}
                disabled={saving}
              >
                Back to edit
              </button>
              <button type="button" className="btn-primary" onClick={save} disabled={saving}>
                {saving ? <Spinner size={15} /> : <ShieldCheck size={15} />} Confirm change
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn-ghost" onClick={requestClose}>
                Cancel
              </button>
              <button type="submit" form="policy-form" className="btn-primary">
                Review change
              </button>
            </>
          )
        }
      >
        {!form ? null : reviewing ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-ink-200">
              <table className="w-full text-left text-[12.5px]">
                <thead className="bg-ink-50 text-[10.5px] uppercase tracking-[0.12em] text-ink-500">
                  <tr>
                    <th className="px-3 py-2 font-bold">Field</th>
                    <th className="px-3 py-2 font-bold">Current</th>
                    <th className="px-3 py-2 font-bold">New</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {changes.map((change) => (
                    <tr key={change.label}>
                      <td className="px-3 py-2 font-semibold text-midnight">{change.label}</td>
                      <td className="num px-3 py-2 text-muted">{change.from}</td>
                      <td className="num px-3 py-2 font-semibold text-midnight">{change.to}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink-400">
                Reason recorded in the audit trail
              </p>
              <p className="mt-1 rounded-lg bg-ink-50 px-3 py-2 text-[12.5px] text-body">
                {form.reason.trim()}
              </p>
            </div>
            {saveError ? <Alert tone="error">{saveError}</Alert> : null}
          </div>
        ) : (
          <form id="policy-form" onSubmit={proceedToReview} className="space-y-4">
            {fieldErrors._form ? <Alert tone="error">{fieldErrors._form}</Alert> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              {AMOUNT_FIELDS.map(([field, label]) => (
                <label key={field}>
                  <span className="field-label">{label}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={form[field]}
                    onChange={(event) => updateField(field, event.target.value)}
                    className="field-input"
                    aria-invalid={Boolean(fieldErrors[field])}
                  />
                  {fieldErrors[field] ? (
                    <span className="field-error">{fieldErrors[field]}</span>
                  ) : null}
                </label>
              ))}
              <label>
                <span className="field-label">Daily outgoing count</span>
                <input
                  type="number"
                  min="0"
                  max="100000"
                  value={form.dailyOutgoingCount}
                  onChange={(event) => updateField("dailyOutgoingCount", event.target.value)}
                  className="field-input"
                  aria-invalid={Boolean(fieldErrors.dailyOutgoingCount)}
                />
                {fieldErrors.dailyOutgoingCount ? (
                  <span className="field-error">{fieldErrors.dailyOutgoingCount}</span>
                ) : null}
              </label>
              <label>
                <span className="field-label">Fee type</span>
                <select
                  value={form.feeType}
                  onChange={(event) => updateField("feeType", event.target.value)}
                  className="field-input"
                >
                  {FEE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {titleCase(type)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="field-label">Fee basis points</span>
                <input
                  type="number"
                  min="0"
                  max="10000"
                  value={form.feeBps}
                  onChange={(event) => updateField("feeBps", event.target.value)}
                  className="field-input"
                  aria-invalid={Boolean(fieldErrors.feeBps)}
                />
                <span className="mt-1 block text-[11px] text-muted">
                  {(Number(form.feeBps) / 100 || 0).toFixed(2)}% of the principal amount
                </span>
                {fieldErrors.feeBps ? (
                  <span className="field-error">{fieldErrors.feeBps}</span>
                ) : null}
              </label>
              <label>
                <span className="field-label">Business timezone</span>
                <input
                  type="text"
                  value={form.timezone}
                  onChange={(event) => updateField("timezone", event.target.value)}
                  className="field-input"
                  aria-invalid={Boolean(fieldErrors.timezone)}
                />
                {fieldErrors.timezone ? (
                  <span className="field-error">{fieldErrors.timezone}</span>
                ) : null}
              </label>
            </div>
            <label className="block">
              <span className="field-label">Reason for change</span>
              <textarea
                value={form.reason}
                onChange={(event) => updateField("reason", event.target.value)}
                rows={3}
                maxLength={500}
                className="field-input"
                placeholder="Why is this limit or fee changing? Stored with the revision."
                aria-invalid={Boolean(fieldErrors.reason)}
              />
              <span className="mt-1 block text-[11px] text-muted">
                {form.reason.trim().length}/500 · at least 10 characters
              </span>
              {fieldErrors.reason ? (
                <span className="field-error">{fieldErrors.reason}</span>
              ) : null}
            </label>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        onConfirm={closeEditor}
        title="Discard policy edits?"
        description="The values you entered have not been saved."
        confirmLabel="Discard edits"
        cancelLabel="Keep editing"
      />
    </div>
  );
}
