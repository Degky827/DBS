import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  CalendarDays,
  RefreshCw,
  WalletCards,
} from "lucide-react";
import Alert from "../../components/ui/Alert";
import EmptyState from "../../components/ui/EmptyState";
import PageHeader from "../../components/ui/PageHeader";
import { LoadingBlock, Skeleton } from "../../components/ui/Spinner";
import { getMyWallet, listMyTransactions } from "../../services/walletService";
import { normalizeApiError } from "../../utils/apiError";

const PAGE_SIZE = 25;

const dateBoundary = (date, endOfDay = false) => {
  if (!date) return undefined;
  return new Date(
    `${date}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`
  ).toISOString();
};

const money = (amount, currency) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(Number(amount));

const transactionDate = (value) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

export default function Transactions() {
  const [wallet, setWallet] = useState(null);
  const [walletLoading, setWalletLoading] = useState(true);
  const [walletError, setWalletError] = useState("");
  const [transactions, setTransactions] = useState([]);
  const [page, setPage] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [direction, setDirection] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [filterError, setFilterError] = useState("");
  const [appliedFilters, setAppliedFilters] = useState({
    direction: "all",
    fromDate: "",
    toDate: "",
  });
  const [refreshKey, setRefreshKey] = useState(0);
  const loadMoreRef = useRef(false);

  useEffect(() => {
    let active = true;
    const fetchWallet = async () => {
      setWalletLoading(true);
      setWalletError("");
      try {
        const currentWallet = await getMyWallet();
        if (active) setWallet(currentWallet);
      } catch (error) {
        if (!active) return;
        if (error?.response?.status === 404) {
          setWallet(null);
        } else {
          setWalletError(normalizeApiError(error).message);
        }
      } finally {
        if (active) setWalletLoading(false);
      }
    };
    fetchWallet();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!wallet) return undefined;
    let active = true;
    const fetchHistory = async () => {
      setTransactions([]);
      setPage(null);
      setHistoryLoading(true);
      setHistoryError("");
      try {
        const result = await listMyTransactions({
          limit: PAGE_SIZE,
          direction: appliedFilters.direction,
          from: dateBoundary(appliedFilters.fromDate),
          to: dateBoundary(appliedFilters.toDate, true),
        });
        if (active) {
          setTransactions(result.transactions);
          setPage(result.page);
        }
      } catch (error) {
        if (active) setHistoryError(normalizeApiError(error).message);
      } finally {
        if (active) setHistoryLoading(false);
      }
    };
    fetchHistory();
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
      const result = await listMyTransactions({
        limit: PAGE_SIZE,
        cursor: page.nextCursor,
        direction: appliedFilters.direction,
        from: dateBoundary(appliedFilters.fromDate),
        to: dateBoundary(appliedFilters.toDate, true),
      });
      setTransactions((current) => [...current, ...result.transactions]);
      setPage(result.page);
    } catch (error) {
      setHistoryError(normalizeApiError(error).message);
    } finally {
      loadMoreRef.current = false;
      setHistoryLoading(false);
    }
  };

  const applyFilters = (event) => {
    event.preventDefault();
    if (fromDate && toDate && fromDate > toDate) {
      setFilterError("The start date must be on or before the end date.");
      return;
    }
    setFilterError("");
    setAppliedFilters({ direction, fromDate, toDate });
  };

  const retryWallet = async () => {
    setWalletLoading(true);
    setWalletError("");
    try {
      setWallet(await getMyWallet());
    } catch (error) {
      if (error?.response?.status === 404) setWallet(null);
      else setWalletError(normalizeApiError(error).message);
    } finally {
      setWalletLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Account activity"
        title="Transactions"
        description="Review completed internal wallet transfers. Only activity involving your own wallet is shown."
        actions={
          wallet ? (
            <button
              type="button"
              onClick={() => setRefreshKey((current) => current + 1)}
              disabled={historyLoading}
              className="btn-ghost"
            >
              <RefreshCw size={15} /> Refresh
            </button>
          ) : null
        }
      />

      {walletLoading ? (
        <LoadingBlock label="Loading your wallet activity…" />
      ) : walletError ? (
        <div className="space-y-3">
          <Alert tone="error">{walletError}</Alert>
          <button type="button" onClick={retryWallet} className="btn-ghost">
            <RefreshCw size={15} /> Try again
          </button>
        </div>
      ) : !wallet ? (
        <EmptyState
          icon={WalletCards}
          title="Create a wallet to view transactions"
          description="Transaction history is available after your ETB wallet is created."
          actionLabel="Go to wallet"
          actionTo="/wallet"
        />
      ) : (
        <section className="card p-5 sm:p-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold text-navy-900">Transfer history</h2>
              <p className="mt-1 text-sm text-ink-500">
                Amounts and direction are shown from your wallet’s perspective.
              </p>
            </div>
            <span className="badge-info">ETB wallet</span>
          </div>

          <form
            onSubmit={applyFilters}
            className="mb-5 grid gap-3 rounded-lg bg-ink-50 p-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            <label className="space-y-1 text-xs font-bold text-ink-500">
              Direction
              <select
                value={direction}
                onChange={(event) => setDirection(event.target.value)}
                className="field-input"
              >
                <option value="all">All activity</option>
                <option value="incoming">Incoming</option>
                <option value="outgoing">Outgoing</option>
              </select>
            </label>
            <label className="space-y-1 text-xs font-bold text-ink-500">
              From date
              <input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
                className="field-input"
              />
            </label>
            <label className="space-y-1 text-xs font-bold text-ink-500">
              To date
              <input
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
                className="field-input"
              />
            </label>
            <button type="submit" disabled={historyLoading} className="btn-ghost self-end">
              <CalendarDays size={15} /> Apply filters
            </button>
          </form>

          {filterError ? <Alert tone="error" className="mb-4">{filterError}</Alert> : null}
          {historyError ? (
            <Alert tone="error" className="mb-4">
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

          {historyLoading && transactions.length === 0 ? (
            <div className="space-y-3 py-2" role="status" aria-label="Loading transactions">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : transactions.length === 0 && !historyError ? (
            <EmptyState
              icon={ArrowLeftRight}
              title="No transfers found"
              description="Completed incoming and outgoing transfers matching these filters will appear here."
              className="shadow-none"
            />
          ) : (
            <div className="divide-y divide-ink-100">
              {transactions.map((transaction) => {
                const outgoing = transaction.sourceWalletId === wallet.id;
                return (
                  <article
                    key={transaction.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink-100 text-ink-600">
                        {outgoing ? <ArrowUpRight size={18} /> : <ArrowDownLeft size={18} />}
                      </span>
                      <div className="min-w-0">
                        <p className="font-bold text-navy-900">
                          {outgoing ? "Sent transfer" : "Received transfer"}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-ink-500">
                          Ref {transaction.reference} · {transactionDate(transaction.createdAt)}
                        </p>
                      </div>
                    </div>
                    <p
                      className={`num font-extrabold ${
                        outgoing ? "text-ink-700" : "text-emerald-700"
                      }`}
                    >
                      {outgoing ? "−" : "+"}
                      {money(transaction.amount, wallet.currency)}
                    </p>
                  </article>
                );
              })}
            </div>
          )}

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
          <p className="mt-4 text-xs text-ink-400">
            Showing only committed transfers. Deposits and withdrawals are not available.
          </p>
          <Link to="/wallet" className="link mt-3 inline-flex text-xs">
            View wallet balance
          </Link>
        </section>
      )}
    </div>
  );
}
