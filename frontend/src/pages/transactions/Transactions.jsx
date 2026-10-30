import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  RefreshCw,
  Search,
  WalletCards,
} from "lucide-react";
import Alert from "../../components/ui/Alert";
import EmptyState from "../../components/ui/EmptyState";
import StatusBadge from "../../components/ui/StatusBadge";
import { LoadingBlock, Skeleton } from "../../components/ui/Spinner";
import { useAccount } from "../../context/AccountContext";
import { listMyTransactions } from "../../services/walletService";
import { normalizeApiError } from "../../utils/apiError";
import { formatCurrency, formatDateTime, titleCase } from "../../utils/format";

const PAGE_SIZE = 25;
const EMPTY_FILTERS = {
  q: "",
  type: "",
  status: "",
  direction: "all",
  fromDate: "",
  toDate: "",
};

const dateBoundary = (date, endOfDay = false) => {
  if (!date) return undefined;
  return new Date(`${date}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`).toISOString();
};

const buildParams = (filters, cursor) => ({
  limit: PAGE_SIZE,
  cursor,
  direction: filters.direction,
  from: dateBoundary(filters.fromDate),
  to: dateBoundary(filters.toDate, true),
  type: filters.type || undefined,
  status: filters.status || undefined,
  q: filters.q.trim() || undefined,
});

function SummaryTile({ label, value, hint, tone }) {
  const valueClass =
    tone === "incoming" ? "text-success" : tone === "muted" ? "text-muted" : "text-midnight";
  return (
    <div className="rounded-xl border border-ink-200 bg-white px-4 py-3.5">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">{label}</p>
      <p className={`num mt-1.5 text-lg font-extrabold ${valueClass}`}>{value}</p>
      <p className="mt-1 text-[11px] leading-snug text-muted">{hint}</p>
    </div>
  );
}

export default function Transactions() {
  const { wallet, loading: accountLoading, walletError } = useAccount();

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState(EMPTY_FILTERS);
  const [filterError, setFilterError] = useState("");
  const [transactions, setTransactions] = useState([]);
  const [page, setPage] = useState(null);
  const [summary, setSummary] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const loadMoreRef = useRef(false);

  useEffect(() => {
    if (!wallet) return undefined;
    let active = true;
    (async () => {
      setTransactions([]);
      setPage(null);
      setHistoryLoading(true);
      setHistoryError("");
      try {
        const result = await listMyTransactions(buildParams(appliedFilters));
        if (!active) return;
        setTransactions(result.transactions || []);
        setSummary(result.summary || null);
        setPage(result.page || null);
      } catch (error) {
        if (active) setHistoryError(normalizeApiError(error).message);
      } finally {
        if (active) setHistoryLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [wallet, appliedFilters, refreshKey]);

  const loadMore = async () => {
    if (!page?.nextCursor || loadMoreRef.current) return;
    loadMoreRef.current = true;
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const result = await listMyTransactions(buildParams(appliedFilters, page.nextCursor));
      setTransactions((current) => [...current, ...(result.transactions || [])]);
      setPage(result.page || null);
      if (result.summary) setSummary(result.summary);
    } catch (error) {
      setHistoryError(normalizeApiError(error).message);
    } finally {
      loadMoreRef.current = false;
      setHistoryLoading(false);
    }
  };

  const applyFilters = (event) => {
    event.preventDefault();
    const search = filters.q.trim();
    if (search && search.length < 3) {
      setFilterError("Search for at least 3 characters of the transaction reference.");
      return;
    }
    if (filters.fromDate && filters.toDate && filters.fromDate > filters.toDate) {
      setFilterError("The start date must be on or before the end date.");
      return;
    }
    setFilterError("");
    setAppliedFilters({ ...filters, q: search });
  };

  const resetFilters = () => {
    setFilterError("");
    setFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
  };

  const activeFilterCount = [
    appliedFilters.q,
    appliedFilters.type,
    appliedFilters.status,
    appliedFilters.direction !== "all" ? appliedFilters.direction : "",
    appliedFilters.fromDate,
    appliedFilters.toDate,
  ].filter(Boolean).length;

  const currency = wallet?.currency || "ETB";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Account activity</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-midnight sm:text-[28px]">
            Transactions
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">
            Search and filter every posted entry that involves your wallet, then open any record for
            its full receipt.
          </p>
        </div>
        {wallet ? (
          <button
            type="button"
            onClick={() => setRefreshKey((current) => current + 1)}
            disabled={historyLoading}
            className="btn-ghost"
          >
            <RefreshCw size={15} className={historyLoading ? "animate-spin" : ""} /> Refresh
          </button>
        ) : null}
      </div>

      {accountLoading ? (
        <LoadingBlock label="Loading your wallet activity…" />
      ) : walletError ? (
        <Alert tone="error">{walletError}</Alert>
      ) : !wallet ? (
        <EmptyState
          icon={WalletCards}
          title="Create a wallet to view transactions"
          description="Transaction history is available after your ETB wallet is created."
          actionLabel="Go to wallet"
          actionTo="/wallet"
        />
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-3" aria-label="Filtered transaction totals">
            <SummaryTile
              label="Incoming"
              tone="incoming"
              value={summary ? formatCurrency(summary.incomingAmount, currency) : "—"}
              hint="Credited to your wallet"
            />
            <SummaryTile
              label="Outgoing"
              tone="default"
              value={summary ? formatCurrency(summary.outgoingAmount, currency) : "—"}
              hint="Debited, including fees"
            />
            <SummaryTile
              label="Matching records"
              tone="muted"
              value={summary ? summary.total : "—"}
              hint="Across both directions"
            />
          </section>

          <section className="card p-5 sm:p-6">
            <form
              onSubmit={applyFilters}
              className="grid gap-3 rounded-lg bg-ink-50 p-4 sm:grid-cols-2 xl:grid-cols-6"
            >
              <label className="space-y-1 text-xs font-bold text-ink-500 sm:col-span-2">
                Search reference
                <div className="relative">
                  <Search
                    size={15}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
                  />
                  <input
                    type="search"
                    value={filters.q}
                    onChange={(event) =>
                      setFilters((current) => ({ ...current, q: event.target.value }))
                    }
                    placeholder="At least 3 characters"
                    className="field-input pl-9"
                    autoComplete="off"
                  />
                </div>
              </label>
              <label className="space-y-1 text-xs font-bold text-ink-500">
                Type
                <select
                  value={filters.type}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, type: event.target.value }))
                  }
                  className="field-input"
                >
                  <option value="">All types</option>
                  <option value="TRANSFER">Transfer</option>
                  <option value="DEPOSIT">Deposit</option>
                </select>
              </label>
              <label className="space-y-1 text-xs font-bold text-ink-500">
                Status
                <select
                  value={filters.status}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, status: event.target.value }))
                  }
                  className="field-input"
                >
                  <option value="">All statuses</option>
                  <option value="POSTED">Posted</option>
                  <option value="PARTIALLY_REVERSED">Partially reversed</option>
                  <option value="REVERSED">Reversed</option>
                </select>
              </label>
              <label className="space-y-1 text-xs font-bold text-ink-500">
                Direction
                <select
                  value={filters.direction}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, direction: event.target.value }))
                  }
                  className="field-input"
                >
                  <option value="all">All activity</option>
                  <option value="incoming">Incoming</option>
                  <option value="outgoing">Outgoing</option>
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2 sm:col-span-2 xl:col-span-2">
                <label className="space-y-1 text-xs font-bold text-ink-500">
                  From date
                  <input
                    type="date"
                    value={filters.fromDate}
                    onChange={(event) =>
                      setFilters((current) => ({ ...current, fromDate: event.target.value }))
                    }
                    className="field-input"
                  />
                </label>
                <label className="space-y-1 text-xs font-bold text-ink-500">
                  To date
                  <input
                    type="date"
                    value={filters.toDate}
                    onChange={(event) =>
                      setFilters((current) => ({ ...current, toDate: event.target.value }))
                    }
                    className="field-input"
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-end gap-2 sm:col-span-2 xl:col-span-4">
                <button type="submit" disabled={historyLoading} className="btn-primary">
                  <Search size={15} /> Apply filters
                </button>
                <button
                  type="button"
                  onClick={resetFilters}
                  disabled={historyLoading || activeFilterCount === 0}
                  className="btn-ghost"
                >
                  Reset
                </button>
                {activeFilterCount > 0 ? (
                  <span className="text-[12px] font-semibold text-muted">
                    {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"} applied
                  </span>
                ) : null}
              </div>
            </form>

            {filterError ? (
              <Alert tone="error" className="mt-4">
                {filterError}
              </Alert>
            ) : null}
            {historyError ? (
              <Alert tone="error" className="mt-4">
                {historyError}
                <button
                  type="button"
                  onClick={() => setRefreshKey((current) => current + 1)}
                  className="ml-2 underline underline-offset-2"
                >
                  Retry
                </button>
              </Alert>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-[15px] font-extrabold text-midnight">History</h2>
                <p className="mt-0.5 text-[12px] text-muted">
                  Amounts are shown from your wallet’s perspective. Totals reflect the search, type,
                  status, and date filters.
                </p>
              </div>
              <span className="badge-info">{currency} wallet</span>
            </div>

            {historyLoading && transactions.length === 0 ? (
              <div className="mt-4 space-y-3 py-2" role="status" aria-label="Loading transactions">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : transactions.length === 0 && !historyError ? (
              <EmptyState
                icon={Search}
                title={activeFilterCount ? "No matching transactions" : "No transactions yet"}
                description={
                  activeFilterCount
                    ? "Adjust or reset the filters to see other wallet activity."
                    : "Posted deposits and transfers involving your wallet will appear here."
                }
                actionLabel={activeFilterCount ? "Reset filters" : undefined}
                onAction={activeFilterCount ? resetFilters : undefined}
                className="mt-4 shadow-none"
              />
            ) : transactions.length > 0 ? (
              <>
                <div className="mt-3 hidden overflow-x-auto md:block">
                  <table className="data-table min-w-[760px]">
                    <thead>
                      <tr>
                        <th scope="col">Reference</th>
                        <th scope="col">Date &amp; time</th>
                        <th scope="col">Type</th>
                        <th scope="col">Direction</th>
                        <th scope="col" className="text-right">
                          Amount
                        </th>
                        <th scope="col" className="text-right">
                          Status
                        </th>
                        <th scope="col" className="text-right">
                          <span className="sr-only">Details</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map((transaction) => {
                        const outgoing = transaction.sourceWalletId === wallet.id;
                        return (
                          <tr key={transaction.id}>
                            <td>
                              <Link
                                to={`/transactions/${transaction.reference}`}
                                className="block max-w-[150px] truncate font-mono text-[11px] font-semibold text-brand-700 hover:underline"
                                title={transaction.reference}
                              >
                                {transaction.reference}
                              </Link>
                            </td>
                            <td className="whitespace-nowrap text-[12.5px] text-body">
                              {formatDateTime(transaction.createdAt)}
                            </td>
                            <td className="text-[12.5px] text-muted">
                              {titleCase(transaction.type)}
                            </td>
                            <td className="text-[12.5px] text-muted">
                              {outgoing ? "Outgoing" : "Incoming"}
                            </td>
                            <td
                              className={`num whitespace-nowrap text-right text-[13px] font-extrabold ${
                                outgoing ? "text-midnight" : "text-success"
                              }`}
                            >
                              {outgoing ? "−" : "+"}
                              {formatCurrency(transaction.amount, transaction.currency || currency)}
                            </td>
                            <td className="text-right">
                              <StatusBadge value={transaction.status} />
                            </td>
                            <td className="text-right">
                              <Link
                                to={`/transactions/${transaction.reference}`}
                                aria-label={`View transaction ${transaction.reference}`}
                                className="inline-flex items-center gap-1 text-[12px] font-bold text-brand-700 hover:text-brand-800"
                              >
                                View <ChevronRight size={14} />
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <ul className="mt-2 divide-y divide-ink-100 md:hidden">
                  {transactions.map((transaction) => {
                    const outgoing = transaction.sourceWalletId === wallet.id;
                    return (
                      <li key={transaction.id}>
                        <Link
                          to={`/transactions/${transaction.reference}`}
                          className="flex items-start gap-3 py-3.5"
                        >
                          <span
                            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                              outgoing ? "bg-ink-100 text-muted" : "bg-[#ecfdf3] text-success"
                            }`}
                          >
                            {outgoing ? <ArrowUpRight size={16} /> : <ArrowDownLeft size={16} />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-[13px] font-bold text-midnight">
                                {outgoing ? "Sent" : "Received"}{" "}
                                {titleCase(transaction.type).toLowerCase()}
                              </p>
                              <p
                                className={`num shrink-0 text-[13px] font-extrabold ${
                                  outgoing ? "text-midnight" : "text-success"
                                }`}
                              >
                                {outgoing ? "−" : "+"}
                                {formatCurrency(
                                  transaction.amount,
                                  transaction.currency || currency
                                )}
                              </p>
                            </div>
                            <p className="mt-0.5 truncate text-[11.5px] text-muted">
                              {formatDateTime(transaction.createdAt)} ·{" "}
                              <span className="font-mono">{transaction.reference}</span>
                            </p>
                            <div className="mt-1.5 flex items-center justify-between gap-2">
                              <StatusBadge value={transaction.status} />
                              <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-brand-700">
                                Details <ArrowRight size={12} />
                              </span>
                            </div>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : null}

            {page?.hasMore ? (
              <button
                type="button"
                onClick={loadMore}
                disabled={historyLoading}
                className="btn-ghost mt-5 w-full justify-center"
              >
                {historyLoading ? "Loading…" : "Load more transactions"}
              </button>
            ) : null}
            {transactions.length > 0 ? (
              <p className="mt-4 text-xs text-ink-400">
                Showing {transactions.length} of {page?.total ?? transactions.length} matching
                record{(page?.total ?? transactions.length) === 1 ? "" : "s"}.
              </p>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
