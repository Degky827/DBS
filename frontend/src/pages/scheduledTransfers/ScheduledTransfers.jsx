import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, Pause, Play, Plus, RefreshCw, Trash2 } from "lucide-react";
import FieldInput from "../../components/FieldInput";
import PageHeader from "../../components/ui/PageHeader";
import Alert from "../../components/ui/Alert";
import EmptyState from "../../components/ui/EmptyState";
import Modal, { ConfirmDialog } from "../../components/ui/Modal";
import StatusBadge from "../../components/ui/StatusBadge";
import { Skeleton } from "../../components/ui/Spinner";
import { useAccount } from "../../context/AccountContext";
import {
  cancelScheduledTransfer,
  createScheduledTransfer,
  listScheduledTransfers,
  pauseScheduledTransfer,
  resumeScheduledTransfer,
} from "../../services/scheduledTransfersService";
import { normalizeApiError } from "../../utils/apiError";
import { formatCurrency, formatDateTime, titleCase } from "../../utils/format";
import { isKycApproved, kycCopy } from "../../utils/kyc";

const AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,16})(?:\.\d{1,2})?$/;
const WALLET_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 25;

const FREQUENCY_OPTIONS = [
  { value: "ONCE", label: "One time" },
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
];

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "ACTIVE", label: "Active" },
  { value: "PAUSED", label: "Paused" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "FAILED", label: "Needs attention" },
];

const EMPTY_FORM = {
  destinationWalletId: "",
  amount: "",
  frequency: "MONTHLY",
  firstRunAt: "",
};

const localIso = (value) => (value ? new Date(value).toISOString() : "");

const defaultFirstRun = () => {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  date.setSeconds(0, 0);
  const pad = (n) => `${n}`.padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
};

const validate = (form) => {
  const errors = {};
  const walletId = form.destinationWalletId.trim();
  if (!walletId) errors.destinationWalletId = "Enter the destination wallet ID.";
  else if (!WALLET_ID_PATTERN.test(walletId)) {
    errors.destinationWalletId = "Enter a valid wallet ID in UUID format.";
  }
  if (!form.amount) errors.amount = "Enter an amount.";
  else if (!AMOUNT_PATTERN.test(form.amount) || Number(form.amount) <= 0) {
    errors.amount = "Enter a positive amount with at most two decimal places.";
  }
  if (!form.firstRunAt) errors.firstRunAt = "Pick when the first transfer should run.";
  else if (new Date(form.firstRunAt).getTime() <= Date.now()) {
    errors.firstRunAt = "Choose a time in the future.";
  }
  return errors;
};

export default function ScheduledTransfers() {
  const { wallet, kyc, kycUnavailable } = useAccount();

  const [schedules, setSchedules] = useState([]);
  const [page, setPage] = useState(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM, firstRunAt: defaultFirstRun() });
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingCancel, setPendingCancel] = useState(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const data = await listScheduledTransfers({
          status: status || undefined,
          limit: PAGE_SIZE,
        });
        if (!active) return;
        setSchedules(data.schedules || []);
        setPage(data.page || null);
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

  const loadMore = async () => {
    if (!page?.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await listScheduledTransfers({
        status: status || undefined,
        limit: PAGE_SIZE,
        cursor: page.nextCursor,
      });
      setSchedules((current) => [...current, ...(data.schedules || [])]);
      setPage(data.page || null);
    } catch (requestError) {
      setError(normalizeApiError(requestError).message);
    } finally {
      setLoadingMore(false);
    }
  };

  const setField = (key) => (event) => {
    const { value } = event.target;
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: "" }));
  };

  const submit = async (event) => {
    event.preventDefault();
    const errors = validate(form);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      const result = await createScheduledTransfer({
        destinationWalletId: form.destinationWalletId.trim(),
        amount: form.amount,
        frequency: form.frequency,
        firstRunAt: localIso(form.firstRunAt),
      });
      setSchedules((current) => [result.schedule, ...current]);
      setFormOpen(false);
      setForm({ ...EMPTY_FORM, firstRunAt: defaultFirstRun() });
    } catch (requestError) {
      const normalized = normalizeApiError(requestError);
      setFieldErrors(normalized.fields);
      setFormError(normalized.message);
    } finally {
      setSaving(false);
    }
  };

  const runAction = async (schedule, action) => {
    setBusyId(schedule.id);
    setActionError("");
    try {
      const result = await { pause: pauseScheduledTransfer, resume: resumeScheduledTransfer }[
        action
      ](schedule.id);
      setSchedules((current) =>
        current.map((item) => (item.id === result.schedule.id ? result.schedule : item))
      );
    } catch (requestError) {
      setActionError(normalizeApiError(requestError).message);
    } finally {
      setBusyId(null);
    }
  };

  const confirmCancel = async () => {
    if (!pendingCancel) return;
    setCancelling(true);
    setActionError("");
    try {
      const result = await cancelScheduledTransfer(pendingCancel.id);
      setSchedules((current) =>
        current.map((item) => (item.id === result.schedule.id ? result.schedule : item))
      );
      setPendingCancel(null);
    } catch (requestError) {
      setActionError(normalizeApiError(requestError).message);
      setPendingCancel(null);
    } finally {
      setCancelling(false);
    }
  };

  const approved = isKycApproved(kyc);
  const kycGuidance = kycCopy(kyc);
  const currency = wallet?.currency || "ETB";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Everyday banking"
        title="Scheduled transfers"
        description="Set a recurring or future transfer once and let the bank run it on schedule. Pause, resume or cancel at any time; each execution is idempotent so a retry can never debit twice."
        actions={
          <>
            <label className="flex items-center gap-2 text-[12px] font-bold text-muted">
              Status
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                className="field-input !w-auto !py-1.5 text-[12.5px]"
                aria-label="Filter scheduled transfers by status"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              disabled={!approved || !wallet?.isActive}
              className="btn-primary"
            >
              <Plus size={15} /> New schedule
            </button>
          </>
        }
      />

      {!wallet ? (
        <EmptyState
          icon={CalendarClock}
          title="Create a wallet first"
          description="Scheduled transfers move money from your ETB wallet, so create it before scheduling."
          actionLabel="Go to wallet"
          actionTo="/wallet"
        />
      ) : !approved ? (
        <Alert tone="warning">
          <span className="font-bold">
            {kycUnavailable
              ? "Verification status unavailable."
              : "Identity verification required."}
          </span>{" "}
          Scheduling stays locked until your identity is approved.{" "}
          <Link to={kycGuidance.nextTo} className="font-bold underline underline-offset-2">
            {kycGuidance.nextLabel}
          </Link>
        </Alert>
      ) : null}

      {error ? (
        <Alert tone="error" dismissible onDismiss={() => setError("")}>
          {error}
        </Alert>
      ) : null}
      {actionError ? (
        <Alert tone="error" dismissible onDismiss={() => setActionError("")}>
          {actionError}
        </Alert>
      ) : null}

      {loading ? (
        <div className="space-y-3" role="status" aria-label="Loading schedules">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : schedules.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No scheduled transfers"
          description={
            status
              ? "No schedules match this status filter."
              : "Create a schedule to send rent, savings or support payments automatically."
          }
          actionLabel={status ? "Show all statuses" : undefined}
          onAction={status ? () => setStatus("") : undefined}
        />
      ) : (
        <ul className="space-y-3">
          {schedules.map((schedule) => {
            const canPause = schedule.status === "ACTIVE";
            const canResume = schedule.status === "PAUSED";
            const canCancel = ["ACTIVE", "PAUSED", "FAILED"].includes(schedule.status);
            return (
              <li key={schedule.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[15px] font-extrabold text-midnight">
                        {formatCurrency(schedule.amount, schedule.currency || currency)} ·{" "}
                        {FREQUENCY_OPTIONS.find((f) => f.value === schedule.frequency)?.label ||
                          titleCase(schedule.frequency)}
                      </p>
                      <StatusBadge value={schedule.status} />
                    </div>
                    <p className="mt-1 break-all font-mono text-[11px] text-muted">
                      to wallet {schedule.destinationWalletId}
                    </p>
                    <dl className="mt-3 grid gap-x-8 gap-y-1.5 text-[12.5px] sm:grid-cols-2">
                      <div className="flex justify-between gap-3 sm:justify-start sm:gap-2">
                        <dt className="text-muted">Next run</dt>
                        <dd className="font-semibold text-midnight">
                          {schedule.nextRunAt ? formatDateTime(schedule.nextRunAt) : "—"}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3 sm:justify-start sm:gap-2">
                        <dt className="text-muted">Last run</dt>
                        <dd className="font-semibold text-body">
                          {schedule.lastRunAt ? formatDateTime(schedule.lastRunAt) : "Never"}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3 sm:justify-start sm:gap-2">
                        <dt className="text-muted">Timezone</dt>
                        <dd className="font-semibold text-body">{schedule.timezone}</dd>
                      </div>
                      <div className="flex justify-between gap-3 sm:justify-start sm:gap-2">
                        <dt className="text-muted">Schedule ID</dt>
                        <dd className="truncate font-mono text-[11px] text-ink-500">
                          {schedule.id.slice(0, 8)}
                        </dd>
                      </div>
                    </dl>
                    {schedule.failureReason ? (
                      <Alert tone="warning" className="mt-3">
                        Last attempt failed: {schedule.failureReason}. The schedule is paused — fix
                        the cause and resume it, or cancel it.
                      </Alert>
                    ) : null}
                    {schedule.lastTransactionId ? (
                      <p className="mt-2 text-[11.5px] text-muted">
                        Last posted transaction:{" "}
                        <span className="font-mono">{schedule.lastTransactionId.slice(0, 8)}</span>
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {canPause ? (
                      <button
                        type="button"
                        onClick={() => runAction(schedule, "pause")}
                        disabled={busyId === schedule.id}
                        className="btn-ghost"
                      >
                        <Pause size={14} /> Pause
                      </button>
                    ) : null}
                    {canResume ? (
                      <button
                        type="button"
                        onClick={() => runAction(schedule, "resume")}
                        disabled={busyId === schedule.id}
                        className="btn-brand-outline"
                      >
                        <Play size={14} /> Resume
                      </button>
                    ) : null}
                    {canCancel ? (
                      <button
                        type="button"
                        onClick={() => setPendingCancel(schedule)}
                        disabled={busyId === schedule.id}
                        className="btn-danger-outline"
                      >
                        <Trash2 size={14} /> Cancel
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {page?.hasMore ? (
        <div className="flex justify-center">
          <button type="button" onClick={loadMore} disabled={loadingMore} className="btn-ghost">
            {loadingMore ? <RefreshCw size={15} className="animate-spin" /> : null} Load more
          </button>
        </div>
      ) : null}

      <Modal
        open={formOpen}
        onClose={saving ? undefined : () => setFormOpen(false)}
        title="Schedule a transfer"
        description="The first run happens at the time you choose. Recurring schedules continue until you pause or cancel them."
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
            <button type="submit" form="schedule-form" className="btn-primary" disabled={saving}>
              {saving ? (
                <>
                  <RefreshCw size={15} className="animate-spin" /> Creating…
                </>
              ) : (
                "Create schedule"
              )}
            </button>
          </>
        }
      >
        <form id="schedule-form" onSubmit={submit} className="space-y-4" noValidate>
          {formError ? <Alert tone="error">{formError}</Alert> : null}
          <FieldInput
            label="Destination wallet ID"
            name="destinationWalletId"
            value={form.destinationWalletId}
            onChange={setField("destinationWalletId")}
            error={fieldErrors.destinationWalletId}
            hint="Find saved beneficiaries under Beneficiaries."
            placeholder="00000000-0000-0000-0000-000000000000"
            required
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldInput
              label={`Amount (${currency})`}
              name="amount"
              value={form.amount}
              onChange={setField("amount")}
              error={formError ? "" : fieldErrors.amount}
              hint={wallet ? `Available: ${formatCurrency(wallet.balance, currency)}` : undefined}
              placeholder="0.00"
              required
            />
            <FieldInput
              label="Frequency"
              name="frequency"
              type="select"
              value={form.frequency}
              onChange={setField("frequency")}
              options={FREQUENCY_OPTIONS}
              error={fieldErrors.frequency}
            />
          </div>
          <FieldInput
            label="First run"
            name="firstRunAt"
            type="datetime-local"
            value={form.firstRunAt}
            onChange={setField("firstRunAt")}
            error={fieldErrors.firstRunAt}
            hint="Schedules run in UTC and are converted to your wallet timezone for display."
            required
          />
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingCancel)}
        onClose={() => setPendingCancel(null)}
        onConfirm={confirmCancel}
        busy={cancelling}
        tone="danger"
        title="Cancel schedule"
        description={
          pendingCancel
            ? `${titleCase(pendingCancel.frequency)} transfer of ${formatCurrency(
                pendingCancel.amount,
                pendingCancel.currency || currency
              )} will stop running. Already-posted transfers are unaffected.`
            : ""
        }
        confirmLabel="Cancel schedule"
        cancelLabel="Keep running"
      />
    </div>
  );
}
