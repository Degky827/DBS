import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LockKeyhole, Search, ShieldOff, UserRound, Users } from "lucide-react";
import {
  getAdminUser,
  listAdminUsers,
  resetAdminUserMfa,
  updateAdminUserStatus,
} from "../../services/staffService";
import { normalizeApiError } from "../../utils/apiError";
import {
  displayValue,
  formatCurrency,
  formatDate,
  formatDateTime,
  titleCase,
} from "../../utils/format";
import { roleLabel } from "../../utils/roles";
import PageHeader from "../../components/ui/PageHeader";
import Alert from "../../components/ui/Alert";
import StatusBadge from "../../components/ui/StatusBadge";
import EmptyState from "../../components/ui/EmptyState";
import Modal, { ConfirmDialog } from "../../components/ui/Modal";
import { Spinner } from "../../components/ui/Spinner";

const ROLE_OPTIONS = [
  ["", "All roles"],
  ["USER", "Customer"],
  ["VERIFICATION_OFFICER", "Verification officer"],
  ["FINANCIAL_OFFICER", "Financial officer"],
  ["ADMIN", "Administrator"],
  ["OFFICER", "Officer"],
];

// Mirrors the transitions enforced by user-service and auth-service so the
// control only offers statuses the backend will accept.
const STATUS_TRANSITIONS = {
  ACTIVE: ["FROZEN", "SUSPENDED", "CLOSED"],
  FROZEN: ["ACTIVE", "SUSPENDED", "CLOSED"],
  SUSPENDED: ["ACTIVE", "FROZEN", "CLOSED"],
  CLOSED: [],
};

const STATUS_LABELS = {
  ACTIVE: "Active",
  FROZEN: "Frozen",
  SUSPENDED: "Suspended",
  CLOSED: "Closed",
};

const STATUS_TONES = {
  ACTIVE: "badge-success",
  FROZEN: "badge-warning",
  SUSPENDED: "badge-danger",
  CLOSED: "badge-neutral",
};

const fullName = (user) =>
  [user?.firstName, user?.middleName, user?.lastName].filter(Boolean).join(" ");

export default function AdminUsers() {
  const [filters, setFilters] = useState({ q: "", role: "" });
  const [applied, setApplied] = useState({ q: "", role: "" });
  const [users, setUsers] = useState([]);
  const [page, setPage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const [statusForm, setStatusForm] = useState({ status: "", reason: "" });
  const [statusSubmitting, setStatusSubmitting] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [mfaConfirmOpen, setMfaConfirmOpen] = useState(false);
  const [mfaSubmitting, setMfaSubmitting] = useState(false);
  const [mfaError, setMfaError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await listAdminUsers({
          limit: 25,
          ...(applied.q ? { q: applied.q } : {}),
          ...(applied.role ? { role: applied.role } : {}),
        });
        if (!active) return;
        setUsers(data.users);
        setPage(data.page);
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
  }, [applied]);

  const applyFilters = (event) => {
    event.preventDefault();
    setLoading(true);
    setApplied({ q: filters.q.trim(), role: filters.role });
  };

  const resetFilters = () => {
    setFilters({ q: "", role: "" });
    setLoading(true);
    setApplied({ q: "", role: "" });
  };

  const loadMore = async () => {
    if (!page?.nextCursor) return;
    setLoadingMore(true);
    try {
      const data = await listAdminUsers({
        limit: 25,
        cursor: page.nextCursor,
        ...(applied.q ? { q: applied.q } : {}),
        ...(applied.role ? { role: applied.role } : {}),
      });
      setUsers((current) => [...current, ...data.users]);
      setPage(data.page);
    } catch (requestError) {
      setError(normalizeApiError(requestError).message);
    } finally {
      setLoadingMore(false);
    }
  };

  const resetActionState = () => {
    setStatusForm({ status: "", reason: "" });
    setStatusError("");
    setActionNotice("");
    setMfaError("");
  };

  const openUser = async (userId) => {
    setDetail({ id: userId });
    setDetailLoading(true);
    setDetailError("");
    resetActionState();
    try {
      const data = await getAdminUser(userId);
      setDetail(data);
    } catch (requestError) {
      setDetailError(normalizeApiError(requestError).message);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setDetail(null);
    setDetailError("");
    setMfaConfirmOpen(false);
    resetActionState();
  };

  const currentStatus = detail?.user?.accountStatus || "ACTIVE";
  const statusOptions = currentStatus === "ACTIVE" ? [] : ["ACTIVE"];
  statusOptions.push(...(STATUS_TRANSITIONS[currentStatus] || []));
  const nextStatusRequiresReason =
    Boolean(statusForm.status) && statusForm.status !== "ACTIVE";

  const submitStatus = async (event) => {
    event.preventDefault();
    if (statusSubmitting || !detail?.user) return;

    if (!statusForm.status) {
      setStatusError("Choose the status to apply.");
      return;
    }
    if (nextStatusRequiresReason && statusForm.reason.trim().length < 3) {
      setStatusError("A reason of at least 3 characters is required.");
      return;
    }

    setStatusSubmitting(true);
    setStatusError("");
    setActionNotice("");
    try {
      const result = await updateAdminUserStatus(detail.user.id, {
        status: statusForm.status,
        ...(nextStatusRequiresReason ? { reason: statusForm.reason.trim() } : {}),
      });
      const nextStatus = result.accountStatus;
      setDetail((current) =>
        current?.user
          ? { ...current, user: { ...current.user, accountStatus: nextStatus } }
          : current
      );
      setUsers((current) =>
        current.map((user) =>
          user.id === detail.user.id ? { ...user, accountStatus: nextStatus } : user
        )
      );
      setStatusForm({ status: "", reason: "" });
      setActionNotice(
        `Account status changed to ${STATUS_LABELS[nextStatus] || nextStatus}.`
      );
    } catch (requestError) {
      setStatusError(normalizeApiError(requestError).message);
    } finally {
      setStatusSubmitting(false);
    }
  };

  const confirmResetMfa = async () => {
    if (mfaSubmitting || !detail?.user) return;
    setMfaSubmitting(true);
    setMfaError("");
    setActionNotice("");
    try {
      await resetAdminUserMfa(detail.user.id);
      setDetail((current) =>
        current?.user
          ? { ...current, user: { ...current.user, mfaEnabled: false } }
          : current
      );
      setUsers((current) =>
        current.map((user) =>
          user.id === detail.user.id ? { ...user, mfaEnabled: false } : user
        )
      );
      setMfaConfirmOpen(false);
      setActionNotice("Multi-factor authentication was reset for this account.");
    } catch (requestError) {
      setMfaConfirmOpen(false);
      setMfaError(normalizeApiError(requestError).message);
    } finally {
      setMfaSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="User management"
        description="Search customer and staff accounts, freeze or close an account, and reset a compromised authenticator. Role assignment is not managed from this screen."
      />

      <form
        onSubmit={applyFilters}
        className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-end"
      >
        <label className="flex-1">
          <span className="field-label">Search</span>
          <div className="relative">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
            />
            <input
              type="search"
              value={filters.q}
              onChange={(event) =>
                setFilters((current) => ({ ...current, q: event.target.value }))
              }
              placeholder="Name, email or username"
              className="field-input !pl-9"
            />
          </div>
        </label>
        <label className="sm:w-56">
          <span className="field-label">Role</span>
          <select
            value={filters.role}
            onChange={(event) =>
              setFilters((current) => ({ ...current, role: event.target.value }))
            }
            className="field-input"
          >
            {ROLE_OPTIONS.map(([value, label]) => (
              <option key={value || "all"} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? <Spinner size={15} /> : null} Apply
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={resetFilters}
            disabled={loading}
          >
            Reset
          </button>
        </div>
      </form>

      {error ? <Alert tone="error">{error}</Alert> : null}

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-5 py-4">
          <div>
            <h2 className="text-[15px] font-extrabold text-midnight">Accounts</h2>
            <p className="mt-0.5 text-[12px] text-muted">
              {page ? `${page.total} account${page.total === 1 ? "" : "s"} match this view` : "Loading accounts"}
            </p>
          </div>
          <button
            type="button"
            className="btn-ghost !py-2 !text-[13px]"
            onClick={() => {
              setLoading(true);
              setApplied((current) => ({ ...current }));
            }}
            disabled={loading}
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 px-5 py-16 text-[13px] font-semibold text-ink-500">
            <Spinner size={16} className="text-brand-600" /> Loading accounts…
          </div>
        ) : users.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No accounts found"
            description="Adjust the search term or role filter to widen the results."
            className="border-0 shadow-none"
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Wallet</th>
                    <th>Activity</th>
                    <th>Joined</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <p className="font-semibold text-midnight">{fullName(user)}</p>
                        <p className="text-[12px] text-muted">{user.email}</p>
                      </td>
                      <td>
                        <span className="badge-neutral">{roleLabel(user.role)}</span>
                      </td>
                      <td>
                        <StatusBadge
                          value={user.accountStatus || "ACTIVE"}
                          tone={STATUS_TONES[user.accountStatus || "ACTIVE"]}
                        />
                      </td>
                      <td className="text-[12.5px]">
                        {user.wallet
                          ? `${user.wallet.currency} · ${user.wallet.isActive ? "Active" : "Inactive"}`
                          : "Not created"}
                      </td>
                      <td className="num text-[12.5px] text-muted">
                        {user.counts.transactions} tx · {user.counts.payments} payments
                      </td>
                      <td className="whitespace-nowrap text-[12px] text-muted">
                        {formatDate(user.createdAt)}
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          className="link text-[12px]"
                          onClick={() => openUser(user.id)}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-ink-100 md:hidden">
              {users.map((user) => (
                <li key={user.id} className="px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-bold text-midnight">
                        {fullName(user)}
                      </p>
                      <p className="truncate text-[12px] text-muted">{user.email}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
                        {roleLabel(user.role)} · joined {formatDate(user.createdAt)}
                        <StatusBadge
                          value={user.accountStatus || "ACTIVE"}
                          tone={STATUS_TONES[user.accountStatus || "ACTIVE"]}
                        />
                      </p>
                    </div>
                    <button
                      type="button"
                      className="link shrink-0 text-[12px]"
                      onClick={() => openUser(user.id)}
                    >
                      View
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            {page?.hasMore ? (
              <div className="border-t border-ink-100 px-4 py-3 text-center">
                <button
                  type="button"
                  className="btn-ghost !py-2 !text-[13px]"
                  onClick={loadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? <Spinner size={14} /> : null} Load more
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>

      <Modal
        open={Boolean(detail)}
        onClose={closeDetail}
        title="Account details"
        description="Profile and wallet information available to administrators."
        size="lg"
        footer={
          <button type="button" className="btn-ghost" onClick={closeDetail}>
            Close
          </button>
        }
      >
        {detailLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[13px] font-semibold text-ink-500">
            <Spinner size={16} className="text-brand-600" /> Loading account…
          </div>
        ) : detailError ? (
          <Alert tone="error">{detailError}</Alert>
        ) : detail?.user ? (
          <div className="space-y-5">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-navy-50 text-navy-700">
                <UserRound size={20} />
              </span>
              <div>
                <p className="text-[15px] font-extrabold text-midnight">
                  {fullName(detail.user)}
                </p>
                <p className="text-[12.5px] text-muted">{detail.user.email}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
                  @{detail.user.username} · {roleLabel(detail.user.role)}
                  <StatusBadge
                    value={currentStatus}
                    tone={STATUS_TONES[currentStatus]}
                  />
                </p>
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-3 text-[12.5px]">
              {[
                ["Phone", detail.user.phoneNumber],
                ["Date of birth", formatDate(detail.user.dateOfBirth)],
                ["Gender", titleCase(detail.user.gender)],
                ["Created", formatDateTime(detail.user.createdAt)],
                ["City", displayValue(detail.user.city)],
                ["Country", displayValue(detail.user.country)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink-400">
                    {label}
                  </dt>
                  <dd className="mt-0.5 font-semibold text-body">{value}</dd>
                </div>
              ))}
            </dl>

            <div className="rounded-lg border border-ink-100 bg-ink-50 px-4 py-3">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink-400">
                Wallet
              </p>
              {detail.user.wallet ? (
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                  <span className="num font-bold text-midnight">
                    {formatCurrency(
                      detail.user.wallet.balance,
                      detail.user.wallet.currency
                    )}
                  </span>
                  <StatusBadge
                    value={detail.user.wallet.isActive ? "POSTED" : "CANCELLED"}
                    tone={detail.user.wallet.isActive ? "badge-success" : "badge-neutral"}
                  />
                  <span className="text-[11.5px] text-muted">
                    {detail.user.counts.transactions} transactions ·{" "}
                    {detail.user.counts.withdrawals} withdrawals
                  </span>
                </div>
              ) : (
                <p className="mt-1 text-[12.5px] text-muted">
                  No wallet has been created for this account.
                </p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-[13px] font-extrabold text-midnight">
                  Recent transactions
                </h3>
                <Link
                  to={`/officer/verifications?q=${detail.user.id}`}
                  className="link text-[12px]"
                >
                  Verification queue
                </Link>
              </div>
              {detail.recentTransactions.length === 0 ? (
                <p className="mt-2 text-[12.5px] text-muted">
                  No transactions recorded for this account.
                </p>
              ) : (
                <ul className="mt-2 divide-y divide-ink-100">
                  {detail.recentTransactions.map((transaction) => (
                    <li
                      key={transaction.id}
                      className="flex items-center justify-between gap-3 py-2 text-[12.5px]"
                    >
                      <Link
                        to={`/finance/transactions/${transaction.reference}`}
                        className="truncate font-mono text-[11.5px] font-semibold text-brand-700 hover:underline"
                      >
                        {transaction.reference}
                      </Link>
                      <span className="num whitespace-nowrap font-semibold text-body">
                        {formatCurrency(transaction.amount, transaction.currency)}
                      </span>
                      <StatusBadge value={transaction.status} />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-lg border border-ink-100 px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-[13px] font-extrabold text-midnight">
                  <LockKeyhole size={14} className="text-brand-700" />
                  Account access
                </h3>
                <StatusBadge value={currentStatus} tone={STATUS_TONES[currentStatus]} />
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
                Freezing makes the account read-only. Suspending or closing revokes
                existing sessions immediately. Closing is permanent and requires a
                zero balance with no pending activity.
              </p>

              {actionNotice ? (
                <p className="mt-2 text-[12px] font-semibold text-emerald-700" role="status">
                  {actionNotice}
                </p>
              ) : null}

              {statusOptions.length === 0 ? (
                <p className="mt-3 text-[12px] text-muted">
                  This account is closed. No further status changes are possible.
                </p>
              ) : (
                <form onSubmit={submitStatus} className="mt-3 space-y-3" noValidate>
                  {statusError ? <Alert tone="error">{statusError}</Alert> : null}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label>
                      <span className="field-label">New status</span>
                      <select
                        className="field-input"
                        value={statusForm.status}
                        onChange={(event) =>
                          setStatusForm((current) => ({
                            ...current,
                            status: event.target.value,
                          }))
                        }
                      >
                        <option value="">Select status</option>
                        {statusOptions.map((value) => (
                          <option key={value} value={value}>
                            {STATUS_LABELS[value]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span className="field-label">
                        Reason {nextStatusRequiresReason ? "" : "(optional)"}
                      </span>
                      <input
                        className="field-input"
                        maxLength={500}
                        placeholder="Recorded in the audit log"
                        value={statusForm.reason}
                        onChange={(event) =>
                          setStatusForm((current) => ({
                            ...current,
                            reason: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[11px] leading-relaxed text-muted">
                      {nextStatusRequiresReason
                        ? "A reason of at least 3 characters is required for this change."
                        : "Restoring access signs the user in with a new session only."}
                    </p>
                    <button
                      type="submit"
                      className="btn-primary py-2"
                      disabled={statusSubmitting}
                    >
                      {statusSubmitting ? (
                        <>
                          <Spinner size={14} /> Applying…
                        </>
                      ) : (
                        "Apply status"
                      )}
                    </button>
                  </div>
                </form>
              )}

              <div className="mt-4 border-t border-ink-100 pt-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-bold text-midnight">
                      Authenticator reset
                    </p>
                    <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">
                      {detail.user.mfaEnabled
                        ? "MFA is enabled. Reset only after verifying the user's identity through a trusted channel."
                        : "MFA does not appear to be enabled for this account."}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-danger-outline py-2"
                    onClick={() => {
                      setMfaError("");
                      setMfaConfirmOpen(true);
                    }}
                  >
                    <ShieldOff size={14} /> Reset MFA
                  </button>
                </div>
                {mfaError ? (
                  <div className="mt-2">
                    <Alert tone="error">{mfaError}</Alert>
                  </div>
                ) : null}
              </div>
            </div>

            <p className="text-[11.5px] leading-relaxed text-muted">
              Identity documents are held by the verification service and are not
              exposed here.
            </p>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={mfaConfirmOpen}
        onClose={() => setMfaConfirmOpen(false)}
        onConfirm={confirmResetMfa}
        title="Reset multi-factor authentication?"
        description="The user's authenticator enrollment and recovery codes will be removed. They can enroll again after signing in."
        confirmLabel="Reset MFA"
        busy={mfaSubmitting}
      />
    </div>
  );
}
