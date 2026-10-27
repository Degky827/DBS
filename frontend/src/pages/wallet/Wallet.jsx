import { useEffect, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  RefreshCw,
  WalletCards,
} from "lucide-react";
import Alert from "../../components/ui/Alert";
import EmptyState from "../../components/ui/EmptyState";
import PageHeader from "../../components/ui/PageHeader";
import { Skeleton } from "../../components/ui/Spinner";
import {
  createMyWallet,
  getMyWallet,
  listMyTransactions,
  transferFunds,
} from "../../services/walletService";
import { normalizeApiError } from "../../utils/apiError";

const AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,16})(?:\.\d{1,2})?$/;
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

const makeIdempotencyKey = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export default function Wallet() {
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [page, setPage] = useState(null);
  const [destinationWalletId, setDestinationWalletId] = useState("");
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [appliedFilters, setAppliedFilters] = useState({
    direction: "all",
    fromDate: "",
    toDate: "",
  });
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [notice, setNotice] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const retryKey = useRef(null);
  const retrySignature = useRef("");

  useEffect(() => {
    let active = true;
    const fetchWallet = async () => {
      try {
        const currentWallet = await getMyWallet();
        if (active) setWallet(currentWallet);
      } catch (error) {
        if (!active) return;
        if (error?.response?.status === 404) {
          setWallet(null);
        } else {
          setLoadError(normalizeApiError(error).message);
        }
      } finally {
        if (active) setLoading(false);
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
  }, [wallet, appliedFilters, historyRefresh]);

  const loadMore = async () => {
    if (!page?.nextCursor || historyLoading) return;
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
      setHistoryLoading(false);
    }
  };

  const refresh = async () => {
    setLoading(true);
    setLoadError("");
    try {
      setWallet(await getMyWallet());
      setHistoryRefresh((current) => current + 1);
    } catch (error) {
      setLoadError(normalizeApiError(error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateWallet = async () => {
    setCreating(true);
    setNotice(null);
    setLoadError("");
    try {
      const created = await createMyWallet();
      setWallet(created);
      setNotice({ tone: "success", text: "Your ETB wallet is ready." });
    } catch (error) {
      if (error?.response?.status === 409) {
        try {
          setWallet(await getMyWallet());
          setNotice({ tone: "info", text: "Your wallet already exists." });
        } catch (refreshError) {
          setLoadError(normalizeApiError(refreshError).message);
        }
      } else {
        setLoadError(normalizeApiError(error).message);
      }
    } finally {
      setCreating(false);
    }
  };

  const handleTransfer = async (event) => {
    event.preventDefault();
    if (!AMOUNT_PATTERN.test(amount) || Number(amount) <= 0) {
      setNotice({
        tone: "error",
        text: "Enter a positive amount with no more than two decimal places.",
      });
      return;
    }

    const signature = `${destinationWalletId}:${amount}`;
    if (retrySignature.current !== signature) {
      retrySignature.current = signature;
      retryKey.current = makeIdempotencyKey();
    }

    setTransferring(true);
    setNotice(null);
    try {
      const result = await transferFunds({
        destinationWalletId: destinationWalletId.trim(),
        amount,
        idempotencyKey: retryKey.current,
      });
      setNotice({
        tone: "success",
        text: result.replayed
          ? `This transfer was already processed. Reference: ${result.transaction.reference}`
          : `Transfer complete. Reference: ${result.transaction.reference}`,
      });
      setDestinationWalletId("");
      setAmount("");
      retryKey.current = null;
      retrySignature.current = "";
      await refresh();
    } catch (error) {
      setNotice({ tone: "error", text: normalizeApiError(error).message });
    } finally {
      setTransferring(false);
    }
  };

  const handleFilterSubmit = (event) => {
    event.preventDefault();
    setAppliedFilters({ direction, fromDate, toDate });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Everyday banking"
        title="Wallet & transactions"
        description="View your ETB balance, make internal wallet transfers, and review your transaction history."
        actions={
          wallet ? (
            <button
              type="button"
              onClick={refresh}
              disabled={loading || historyLoading}
              className="btn-ghost"
            >
              <RefreshCw size={15} /> Refresh
            </button>
          ) : null
        }
      />

      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
      {loadError ? <Alert tone="error">{loadError}</Alert> : null}

      {loading ? (
        <div className="card space-y-3 p-6">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-9 w-48" />
        </div>
      ) : wallet ? (
        <>
          <section className="card flex flex-wrap items-center justify-between gap-5 p-6">
            <div className="flex items-center gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-navy-800 text-white">
                <WalletCards size={22} />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink-500">Available balance</p>
                <p className="num mt-1 text-3xl font-extrabold text-navy-900">
                  {money(wallet.balance, wallet.currency)}
                </p>
              </div>
            </div>
            <span className={wallet.isActive ? "badge-success" : "badge-danger"}>
              {wallet.isActive ? "Active" : "Inactive"}
            </span>
          </section>

          <section className="card p-5 sm:p-6">
            <div className="mb-5 flex items-center gap-2">
              <ArrowLeftRight size={18} className="text-navy-700" />
              <h2 className="text-lg font-extrabold text-navy-900">Internal transfer</h2>
            </div>
            {!wallet.isActive ? (
              <Alert tone="warning" className="mb-4">
                This wallet is inactive. Transfers are unavailable until it is reactivated.
              </Alert>
            ) : null}
            <form onSubmit={handleTransfer} className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1.5 text-sm font-semibold text-ink-700">
                Recipient wallet ID
                <input
                  required
                  value={destinationWalletId}
                  onChange={(event) => setDestinationWalletId(event.target.value)}
                  placeholder="Recipient wallet UUID"
                  className="field-input"
                  autoComplete="off"
                />
              </label>
              <label className="space-y-1.5 text-sm font-semibold text-ink-700">
                Amount (ETB)
                <input
                  required
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0.00"
                  className="field-input"
                  autoComplete="off"
                />
              </label>
              <p className="text-xs leading-relaxed text-ink-500 md:col-span-2">
                Transfers are final once confirmed. External deposits and withdrawals are not available.
                If a request times out, retry with the same details to reuse its idempotency key.
              </p>
              <div className="md:col-span-2">
                <button
                  type="submit"
                  disabled={transferring || !wallet.isActive}
                  className="btn-primary"
                >
                  <ArrowUpRight size={16} />
                  {transferring ? "Sending transfer…" : "Transfer funds"}
                </button>
              </div>
            </form>
          </section>

          <section className="card p-5 sm:p-6">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-extrabold text-navy-900">Transaction history</h2>
                <p className="mt-1 text-sm text-ink-500">
                  Your recent incoming and outgoing wallet transfers.
                </p>
              </div>
            </div>

            <form
              onSubmit={handleFilterSubmit}
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
                From
                <input
                  type="date"
                  value={fromDate}
                  onChange={(event) => setFromDate(event.target.value)}
                  className="field-input"
                />
              </label>
              <label className="space-y-1 text-xs font-bold text-ink-500">
                To
                <input
                  type="date"
                  value={toDate}
                  onChange={(event) => setToDate(event.target.value)}
                  className="field-input"
                />
              </label>
              <button
                type="submit"
                disabled={historyLoading}
                className="btn-ghost self-end"
              >
                Apply filters
              </button>
            </form>

            {historyError ? <Alert tone="error">{historyError}</Alert> : null}
            {transactions.length === 0 && !historyLoading ? (
              <EmptyState
                icon={ArrowLeftRight}
                title="No transfers found"
                description="Completed incoming and outgoing transfers will appear here."
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
          </section>
        </>
      ) : (
        <EmptyState
          icon={WalletCards}
          title="Create your ETB wallet"
          description="Your wallet starts at zero. Internal transfers are available after creation; external deposits and withdrawals are currently disabled."
          actionLabel={creating ? "Creating wallet…" : "Create wallet"}
          actionDisabled={creating}
          onAction={handleCreateWallet}
        />
      )}
    </div>
  );
}
