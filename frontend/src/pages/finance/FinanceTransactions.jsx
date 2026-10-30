import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeftRight, Search } from "lucide-react";
import { listPlatformTransactions } from "../../services/staffService";
import { normalizeApiError } from "../../utils/apiError";
import { formatCurrency, formatDateTime, titleCase } from "../../utils/format";
import PageHeader from "../../components/ui/PageHeader";
import Alert from "../../components/ui/Alert";
import EmptyState from "../../components/ui/EmptyState";
import StatusBadge from "../../components/ui/StatusBadge";
import { Spinner } from "../../components/ui/Spinner";

const TYPE_OPTIONS = [
  ["", "All types"],
  ["TRANSFER", "Transfer"],
  ["DEPOSIT", "Deposit"],
  ["WITHDRAWAL", "Withdrawal"],
];

const STATUS_OPTIONS = [
  ["", "All statuses"],
  ["POSTED", "Posted"],
  ["PARTIALLY_REVERSED", "Partially reversed"],
  ["REVERSED", "Reversed"],
];

const emptyFilters = { q: "", type: "", status: "", from: "", to: "" };
const toIso = (value) => (value ? new Date(value).toISOString() : undefined);

const buildParams = (filters, cursor) => ({
  limit: 25,
  ...(cursor ? { cursor } : {}),
  ...(filters.q.trim().length >= 3 ? { q: filters.q.trim() } : {}),
  ...(filters.type ? { type: filters.type } : {}),
  ...(filters.status ? { status: filters.status } : {}),
  ...(filters.from ? { from: toIso(filters.from) } : {}),
  ...(filters.to ? { to: toIso(filters.to) } : {}),
});

const partyName = (party) =>
  party ? [party.firstName, party.lastName].filter(Boolean).join(" ") || party.email : "—";

export default function FinanceTransactions() {
  const [filters, setFilters] = useState(emptyFilters);
  const [applied, setApplied] = useState(emptyFilters);
  const [transactions, setTransactions] = useState([]);
  const [summary, setSummary] = useState(null);
  const [page, setPage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await listPlatformTransactions(buildParams(applied));
        if (!active) return;
        setTransactions(data.transactions);
        setSummary(data.summary);
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
    setApplied({ ...filters });
  };

  const resetFilters = () => {
    setFilters(emptyFilters);
    setLoading(true);
    setApplied(emptyFilters);
  };

  const loadMore = async () => {
    if (!page?.nextCursor) return;
    setLoadingMore(true);
    try {
      const data = await listPlatformTransactions(buildParams(applied, page.nextCursor));
      setTransactions((current) => [...current, ...data.transactions]);
      setPage(data.page);
    } catch (requestError) {
      setError(normalizeApiError(requestError).message);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finance"
        title="Platform transactions"
        description="Read-only view of ledger transactions across all customer wallets. Search by reference, filter by type, status and date, then open a transaction for its reconciliation detail."
      />

      <form onSubmit={applyFilters} className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
        <label className="lg:col-span-2">
          <span className="field-label">Reference</span>
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
              placeholder="Transaction reference (3+ characters)"
              className="field-input !pl-9"
            />
          </div>
        </label>
        <label>
          <span className="field-label">Type</span>
          <select
            value={filters.type}
            onChange={(event) =>
              setFilters((current) => ({ ...current, type: event.target.value }))
            }
            className="field-input"
          >
            {TYPE_OPTIONS.map(([value, label]) => (
              <option key={value || "all"} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">Status</span>
          <select
            value={filters.status}
            onChange={(event) =>
              setFilters((current) => ({ ...current, status: event.target.value }))
            }
            className="field-input"
          >
            {STATUS_OPTIONS.map(([value, label]) => (
              <option key={value || "all"} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">From</span>
          <input
            type="datetime-local"
            value={filters.from}
            onChange={(event) =>
              setFilters((current) => ({ ...current, from: event.target.value }))
            }
            className="field-input"
          />
        </label>
        <label>
          <span className="field-label">To</span>
          <input
            type="datetime-local"
            value={filters.to}
            onChange={(event) =>
              setFilters((current) => ({ ...current, to: event.target.value }))
            }
            className="field-input"
          />
        </label>
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-6">
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? <Spinner size={15} /> : <Search size={15} />} Apply
          </button>
          <button type="button" className="btn-ghost" onClick={resetFilters} disabled={loading}>
            Reset
          </button>
        </div>
      </form>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {summary ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="card px-4 py-3">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink-400">
              Matching transactions
            </p>
            <p className="num mt-1 text-[18px] font-extrabold text-midnight">
              {summary.total}
            </p>
          </div>
          {(summary.byCurrency ?? []).length === 0 ? (
            <div className="card px-4 py-3">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink-400">
                Volume
              </p>
              <p className="mt-1 text-[13px] text-muted">No matching volume</p>
            </div>
          ) : (
            summary.byCurrency.map((row) => (
              <div key={row.currency} className="card px-4 py-3">
                <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink-400">
                  Volume · {row.currency}
                </p>
                <p className="num mt-1 text-[18px] font-extrabold text-midnight">
                  {formatCurrency(row.amount, row.currency)}
                </p>
                <p className="mt-0.5 text-[11px] text-muted">
                  {row.count} transaction{row.count === 1 ? "" : "s"}
                </p>
              </div>
            ))
          )}
        </div>
      ) : null}

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-5 py-4">
          <div>
            <h2 className="text-[15px] font-extrabold text-midnight">Transactions</h2>
            <p className="mt-0.5 text-[12px] text-muted">
              {page
                ? `${page.total} transaction${page.total === 1 ? "" : "s"} match this view`
                : "Loading transactions"}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 px-5 py-16 text-[13px] font-semibold text-ink-500">
            <Spinner size={16} className="text-brand-600" /> Loading transactions…
          </div>
        ) : transactions.length === 0 ? (
          <EmptyState
            icon={ArrowLeftRight}
            title="No transactions in this view"
            description="Adjust the reference, type, status or date range to widen the results."
            className="border-0 shadow-none"
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Timestamp</th>
                    <th>Type</th>
                    <th>Amount</th>
                    <th>Initiated by</th>
                    <th>Provider</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((transaction) => (
                    <tr key={transaction.id}>
                      <td>
                        <span className="block max-w-[11rem] truncate font-mono text-[11.5px] text-midnight">
                          {transaction.reference}
                        </span>
                      </td>
                      <td className="whitespace-nowrap text-[12px] text-muted">
                        {formatDateTime(transaction.createdAt)}
                      </td>
                      <td className="text-[12.5px]">{titleCase(transaction.type)}</td>
                      <td className="num whitespace-nowrap text-[12.5px] font-semibold">
                        {formatCurrency(transaction.amount, transaction.currency)}
                        {Number(transaction.feeAmount) > 0 ? (
                          <span className="block text-[11px] font-normal text-muted">
                            fee {formatCurrency(transaction.feeAmount, transaction.currency)}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <p className="max-w-[10rem] truncate text-[12.5px] text-body">
                          {partyName(transaction.initiatedBy)}
                        </p>
                        <p className="max-w-[10rem] truncate text-[11px] text-muted">
                          {transaction.initiatedBy?.email}
                        </p>
                      </td>
                      <td className="text-[12px] text-muted">
                        {transaction.payment
                          ? `${titleCase(transaction.payment.provider)} · ${titleCase(transaction.payment.status)}`
                          : "—"}
                      </td>
                      <td>
                        <StatusBadge value={transaction.status} />
                      </td>
                      <td className="text-right">
                        <Link
                          to={`/finance/transactions/${transaction.reference}`}
                          className="link text-[12px]"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-ink-100 md:hidden">
              {transactions.map((transaction) => (
                <li key={transaction.id} className="px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-bold text-midnight">
                        {formatCurrency(transaction.amount, transaction.currency)} ·{" "}
                        {titleCase(transaction.type)}
                      </p>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-muted">
                        {transaction.reference}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <StatusBadge value={transaction.status} />
                        <span className="text-[11px] text-muted">
                          {formatDateTime(transaction.createdAt)}
                        </span>
                      </div>
                    </div>
                    <Link
                      to={`/finance/transactions/${transaction.reference}`}
                      className="link shrink-0 text-[12px]"
                    >
                      View
                    </Link>
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
    </div>
  );
}
