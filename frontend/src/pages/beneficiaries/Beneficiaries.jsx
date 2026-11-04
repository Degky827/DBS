import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Pencil, Plus, RefreshCw, Send, Star, Trash2, Users } from "lucide-react";
import FieldInput from "../../components/FieldInput";
import PageHeader from "../../components/ui/PageHeader";
import Alert from "../../components/ui/Alert";
import EmptyState from "../../components/ui/EmptyState";
import Modal, { ConfirmDialog } from "../../components/ui/Modal";
import { LoadingBlock } from "../../components/ui/Spinner";
import {
  createBeneficiary,
  deleteBeneficiary,
  listBeneficiaries,
  updateBeneficiary,
} from "../../services/beneficiariesService";
import { normalizeApiError } from "../../utils/apiError";
import { formatDate, titleCase } from "../../utils/format";

const WALLET_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCOUNT_NUMBER_PATTERN = /^[A-Za-z0-9-]+$/;

const EMPTY_FORM = {
  name: "",
  nickname: "",
  accountNumber: "",
  bankName: "Meridian Bank",
  bankCode: "",
  destinationWalletId: "",
};

// Only send fields the customer actually filled in: the backend schema is
// strict and its optional string fields reject empty values.
const buildPayload = (form, { includeAccountNumber }) => {
  const payload = { name: form.name.trim() };
  if (form.nickname.trim()) payload.nickname = form.nickname.trim();
  if (includeAccountNumber) payload.accountNumber = form.accountNumber.trim();
  if (form.bankName.trim()) payload.bankName = form.bankName.trim();
  if (form.bankCode.trim()) payload.bankCode = form.bankCode.trim();
  if (form.destinationWalletId.trim()) {
    payload.destinationWalletId = form.destinationWalletId.trim();
  }
  return payload;
};

const validate = (form, { accountNumberRequired }) => {
  const errors = {};
  const name = form.name.trim();
  if (name.length < 2 || name.length > 80) {
    errors.name = "Enter a name between 2 and 80 characters.";
  }
  if (form.nickname.trim().length > 40) {
    errors.nickname = "Keep the nickname to 40 characters or fewer.";
  }
  const accountNumber = form.accountNumber.trim();
  if (accountNumberRequired && !accountNumber) {
    errors.accountNumber = "Enter the beneficiary account number.";
  } else if (accountNumber) {
    if (accountNumber.length < 6 || accountNumber.length > 34) {
      errors.accountNumber = "Account numbers are 6 to 34 characters.";
    } else if (!ACCOUNT_NUMBER_PATTERN.test(accountNumber)) {
      errors.accountNumber = "Use letters, digits and dashes only.";
    }
  }
  const bankName = form.bankName.trim();
  if (bankName && (bankName.length < 2 || bankName.length > 80)) {
    errors.bankName = "Bank name must be 2 to 80 characters.";
  }
  if (form.bankCode.trim().length > 20) {
    errors.bankCode = "Bank code must be 20 characters or fewer.";
  }
  const walletId = form.destinationWalletId.trim();
  if (walletId && !WALLET_ID_PATTERN.test(walletId)) {
    errors.destinationWalletId = "Enter a valid destination wallet ID in UUID format.";
  }
  return errors;
};

export default function Beneficiaries() {
  const [beneficiaries, setBeneficiaries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [busyId, setBusyId] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const data = await listBeneficiaries();
        if (active) {
          setBeneficiaries(data.beneficiaries || []);
          setError("");
        }
      } catch (requestError) {
        if (active) setError(normalizeApiError(requestError).message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setFormError("");
    setFormOpen(true);
  };

  const openEdit = (beneficiary) => {
    setEditing(beneficiary);
    setForm({
      name: beneficiary.name || "",
      nickname: beneficiary.nickname || "",
      accountNumber: "",
      bankName: beneficiary.bankName || "",
      bankCode: beneficiary.bankCode || "",
      destinationWalletId: beneficiary.destinationWalletId || "",
    });
    setFieldErrors({});
    setFormError("");
    setFormOpen(true);
  };

  const setField = (key) => (event) => {
    const { value } = event.target;
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: "" }));
  };

  const submit = async (event) => {
    event.preventDefault();
    const accountNumberRequired = !editing;
    const errors = validate(form, { accountNumberRequired });
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setSaving(true);
    setFormError("");
    try {
      const payload = buildPayload(form, {
        includeAccountNumber: accountNumberRequired || Boolean(form.accountNumber.trim()),
      });
      const result = editing
        ? await updateBeneficiary(editing.id, payload)
        : await createBeneficiary(payload);
      setBeneficiaries((current) =>
        editing
          ? current.map((item) => (item.id === result.beneficiary.id ? result.beneficiary : item))
          : [result.beneficiary, ...current]
      );
      setFormOpen(false);
    } catch (requestError) {
      const normalized = normalizeApiError(requestError);
      setFieldErrors(normalized.fields);
      setFormError(normalized.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleFavorite = async (beneficiary) => {
    setBusyId(beneficiary.id);
    setError("");
    try {
      const result = await updateBeneficiary(beneficiary.id, {
        isFavorite: !beneficiary.isFavorite,
      });
      setBeneficiaries((current) =>
        current.map((item) => (item.id === result.beneficiary.id ? result.beneficiary : item))
      );
    } catch (requestError) {
      setError(normalizeApiError(requestError).message);
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setError("");
    try {
      await deleteBeneficiary(pendingDelete.id);
      setBeneficiaries((current) => current.filter((item) => item.id !== pendingDelete.id));
      setPendingDelete(null);
    } catch (requestError) {
      setError(normalizeApiError(requestError).message);
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Everyday banking"
        title="Saved beneficiaries"
        description="Keep the people and accounts you pay most often. Beneficiaries are stored on your profile only; transfers still require the destination wallet ID and your confirmation."
        actions={
          <>
            <Link to="/transfers" className="btn-ghost">
              <Send size={15} /> Send money
            </Link>
            <button type="button" onClick={openCreate} className="btn-primary">
              <Plus size={15} /> Add beneficiary
            </button>
          </>
        }
      />

      {error ? (
        <Alert tone="error" dismissible onDismiss={() => setError("")}>
          {error}
        </Alert>
      ) : null}

      {loading ? (
        <LoadingBlock label="Loading your beneficiaries…" />
      ) : beneficiaries.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No beneficiaries saved yet"
          description="Save a name and account number so you can look it up before every transfer."
          actionLabel="Add your first beneficiary"
          onAction={openCreate}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {beneficiaries.map((beneficiary) => (
            <li key={beneficiary.id} className="card flex h-full flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-extrabold text-midnight">
                    {beneficiary.name}
                  </p>
                  {beneficiary.nickname ? (
                    <p className="mt-0.5 truncate text-[12px] text-muted">
                      “{beneficiary.nickname}”
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => toggleFavorite(beneficiary)}
                  disabled={busyId === beneficiary.id}
                  aria-pressed={beneficiary.isFavorite}
                  aria-label={
                    beneficiary.isFavorite ? `Unpin ${beneficiary.name}` : `Pin ${beneficiary.name}`
                  }
                  className={`rounded-lg p-1.5 transition ${
                    beneficiary.isFavorite
                      ? "text-warning hover:bg-amber-50"
                      : "text-ink-400 hover:bg-ink-50 hover:text-ink-500"
                  }`}
                >
                  <Star size={16} fill={beneficiary.isFavorite ? "currentColor" : "none"} />
                </button>
              </div>

              <dl className="mt-4 space-y-2 text-[12.5px]">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted">Account</dt>
                  <dd className="num font-bold text-midnight">{beneficiary.accountNumber}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted">Bank</dt>
                  <dd className="truncate font-semibold text-body">
                    {beneficiary.bankName || "—"}
                    {beneficiary.bankCode ? ` · ${beneficiary.bankCode}` : ""}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted">Wallet</dt>
                  <dd className="truncate font-mono text-[11px] text-ink-500">
                    {beneficiary.destinationWalletId
                      ? beneficiary.destinationWalletId.slice(0, 8)
                      : titleCase("not_linked")}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted">Saved</dt>
                  <dd className="font-semibold text-body">{formatDate(beneficiary.createdAt)}</dd>
                </div>
              </dl>

              <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => openEdit(beneficiary)}
                  className="btn-ghost flex-1 justify-center"
                >
                  <Pencil size={14} /> Edit
                </button>
                <Link
                  to="/transfers"
                  className="btn-brand-outline flex-1 justify-center"
                  aria-label={`Send money to ${beneficiary.name}`}
                >
                  Transfer <ArrowRight size={14} />
                </Link>
                <button
                  type="button"
                  onClick={() => setPendingDelete(beneficiary)}
                  className="btn-danger-outline px-3"
                  aria-label={`Remove ${beneficiary.name}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={formOpen}
        onClose={saving ? undefined : () => setFormOpen(false)}
        title={editing ? "Edit beneficiary" : "Add beneficiary"}
        description={
          editing
            ? "The account number is stored masked. Leave it blank to keep the current one."
            : "Save the details you transfer to most often."
        }
        footer={
          <>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setFormOpen(false)}
              disabled={saving}
            >
              Cancel
            </button>
            <button type="submit" form="beneficiary-form" className="btn-primary" disabled={saving}>
              {saving ? (
                <>
                  <RefreshCw size={15} className="animate-spin" /> Saving…
                </>
              ) : editing ? (
                "Save changes"
              ) : (
                "Add beneficiary"
              )}
            </button>
          </>
        }
      >
        <form id="beneficiary-form" onSubmit={submit} className="space-y-4" noValidate>
          {formError ? <Alert tone="error">{formError}</Alert> : null}
          <FieldInput
            label="Name"
            name="name"
            value={form.name}
            onChange={setField("name")}
            error={fieldErrors.name}
            placeholder="e.g. Selam Girma"
            required
          />
          <FieldInput
            label="Nickname (optional)"
            name="nickname"
            value={form.nickname}
            onChange={setField("nickname")}
            error={fieldErrors.nickname}
            placeholder="Short label shown in your list"
          />
          <FieldInput
            label="Account number"
            name="accountNumber"
            value={form.accountNumber}
            onChange={setField("accountNumber")}
            error={fieldErrors.accountNumber}
            hint={
              editing ? `Current: ${editing.accountNumber}` : "Letters, digits and dashes only."
            }
            placeholder="1000123456"
            required={!editing}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldInput
              label="Bank name"
              name="bankName"
              value={form.bankName}
              onChange={setField("bankName")}
              error={fieldErrors.bankName}
            />
            <FieldInput
              label="Bank code (optional)"
              name="bankCode"
              value={form.bankCode}
              onChange={setField("bankCode")}
              error={fieldErrors.bankCode}
              placeholder="e.g. 300001"
            />
          </div>
          <FieldInput
            label="Destination wallet ID (optional)"
            name="destinationWalletId"
            value={form.destinationWalletId}
            onChange={setField("destinationWalletId")}
            error={fieldErrors.destinationWalletId}
            hint="Add the Meridian wallet ID so you can copy it straight into a transfer."
            placeholder="00000000-0000-0000-0000-000000000000"
          />
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        busy={deleting}
        title="Remove beneficiary"
        description={
          pendingDelete
            ? `${pendingDelete.name} will be deleted from your saved list. Past transfers are unaffected.`
            : ""
        }
        confirmLabel="Remove"
      />
    </div>
  );
}
