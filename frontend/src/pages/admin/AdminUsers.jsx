import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Search, UserRound, Users } from "lucide-react";
import { getAdminUser, listAdminUsers } from "../../services/staffService";
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
import Modal from "../../components/ui/Modal";
import { Spinner } from "../../components/ui/Spinner";

const ROLE_OPTIONS = [
  ["", "All roles"],
  ["USER", "Customer"],
  ["VERIFICATION_OFFICER", "Verification officer"],
  ["FINANCIAL_OFFICER", "Financial officer"],
  ["ADMIN", "Administrator"],
  ["OFFICER", "Officer"],
];

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

  const openUser = async (userId) => {
    setDetail({ id: userId });
    setDetailLoading(true);
    setDetailError("");
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
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="User management"
        description="Search customer and staff accounts. Account suspension and role assignment are not exposed because the platform does not yet model an account status or a role-management API."
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
                      <p className="mt-1 text-[11.5px] text-muted">
                        {roleLabel(user.role)} · joined {formatDate(user.createdAt)}
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
                <p className="mt-1 text-[11.5px] text-muted">
                  @{detail.user.username} · {roleLabel(detail.user.role)}
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

            <p className="text-[11.5px] leading-relaxed text-muted">
              Identity documents are held by the verification service and are not
              exposed here. Accounts do not carry a suspension status, so no
              suspend or reactivate action is available.
            </p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
