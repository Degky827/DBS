import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDownLeft,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpFromLine,
  ArrowUpRight,
  Eye,
  EyeOff,
  LockKeyhole,
  RefreshCw,
  Send,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import Alert from "../../components/ui/Alert";
import EmptyState from "../../components/ui/EmptyState";
import StatusBadge from "../../components/ui/StatusBadge";
import { Skeleton } from "../../components/ui/Spinner";
import { useAccount } from "../../context/AccountContext";
import { createMyWallet, listMyTransactions } from "../../services/walletService";
import { normalizeApiError } from "../../utils/apiError";
import { formatCurrency, formatDateTime, titleCase } from "../../utils/format";
import { isKycApproved, kycCopy } from "../../utils/kyc";

const BALANCE_VISIBILITY_KEY = "meridian:wallet-balance-visible";
const RECENT_LIMIT = 6;

const readBalancePreference = () => {
  try {
    return localStorage.getItem(BALANCE_VISIBILITY_KEY) !== "false";
  } catch {
    return true;
  }
};

function QuickAction({ to, icon: Icon, label, hint, disabled }) {
  const base = "group flex flex-col gap-2 rounded-xl border border-ink-200 bg-white p-4 transition";
  if (disabled) {
    return (
      <div className={`${base} cursor-not-allowed opacity-60`} aria-disabled="true">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink-50 text-muted">
          <Icon size={17} />
        </span>
        <span className="text-[13px] font-bold text-midnight">{label}</span>
        <span className="text-[11px] leading-snug text-muted">{hint}</span>
      </div>
    );
  }
  return (
    <Link to={to} className={`${base} hover:border-brand-600/40 hover:bg-brand-50/40`}>
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700 transition group-hover:bg-brand-100">
        <Icon size={17} />
      </span>
      <span className="text-[13px] font-bold text-midnight">{label}</span>
      <span className="text-[11px] leading-snug text-muted">{hint}</span>
    </Link>
  );
}

export default function Wallet() {
  const {
    wallet,
    kyc,
    kycUnavailable,
    loading,
    walletError,
    refresh: refreshAccount,
  } = useAccount();

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [balanceVisible, setBalanceVisible] = useState(readBalancePreference);
  const [transactions, setTransactions] = useState([]);
  const [summary, setSummary] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!wallet) return undefined;
    let active = true;
    (async () => {
      setHistoryLoading(true);
      setHistoryError("");
      try {
        const result = await listMyTransactions({ limit: RECENT_LIMIT });
        if (!active) return;
        setTransactions(result.transactions || []);
        setSummary(result.summary || null);
      } catch (error) {
        if (active) setHistoryError(normalizeApiError(error).message);
      } finally {
        if (active) setHistoryLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [wallet, refreshKey]);

  const toggleBalance = () => {
    setBalanceVisible((visible) => {
      try {
        localStorage.setItem(BALANCE_VISIBILITY_KEY, String(!visible));
      } catch {
        /* storage may be unavailable; visibility still toggles for this view */
      }
      return !visible;
    });
  };

  const refresh = () => {
    setRefreshKey((current) => current + 1);
    refreshAccount({ silent: true });
  };

  const handleCreateWallet = async () => {
    setCreating(true);
    setCreateError("");
    try {
      await createMyWallet();
      await refreshAccount({ silent: true });
      setRefreshKey((current) => current + 1);
    } catch (error) {
      if (error?.response?.status === 409) {
        await refreshAccount({ silent: true });
      } else {
        setCreateError(normalizeApiError(error).message);
      }
    } finally {
      setCreating(false);
    }
  };

  const approved = isKycApproved(kyc);
  const kycGuidance = kycCopy(kyc);
  const currency = wallet?.currency || "ETB";
  const isRefreshing = loading || historyLoading;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Everyday banking</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-midnight sm:text-[28px]">
            Wallet
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">
            Your ETB balance, funding options, and recent account activity.
          </p>
        </div>
        {wallet ? (
          <button type="button" onClick={refresh} disabled={isRefreshing} className="btn-ghost">
            <RefreshCw size={15} className={isRefreshing ? "animate-spin" : ""} /> Refresh
          </button>
        ) : null}
      </div>

      {walletError ? <Alert tone="error">{walletError}</Alert> : null}

      {loading ? (
        <div className="card space-y-3 p-6" role="status" aria-label="Loading wallet">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-10 w-56" />
          <Skeleton className="h-4 w-40" />
        </div>
      ) : wallet ? (
        <>
          {!wallet.isActive ? (
            <Alert tone="warning">
              This wallet is inactive. Transfers, deposits, and withdrawals are unavailable until it
              is reactivated. Contact support if you need help.
            </Alert>
          ) : !approved ? (
            <Alert tone="warning">
              <span className="font-bold">
                {kycUnavailable
                  ? "Verification status unavailable."
                  : "Identity verification required."}
              </span>{" "}
              Wallet transfers, deposits, and withdrawals stay locked until your identity is
              approved.{" "}
              <Link to={kycGuidance.nextTo} className="font-bold underline underline-offset-2">
                {kycGuidance.nextLabel}
              </Link>
            </Alert>
          ) : null}

          <section className="overflow-hidden rounded-2xl border border-white/10 bg-midnight text-white shadow-[0_20px_48px_-28px_rgba(11,31,51,.6)]">
            <div className="relative px-5 py-6 sm:px-7 sm:py-7">
              <div
                className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-brand-600/25 blur-3xl"
                aria-hidden="true"
              />
              <div className="relative flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
                    Available balance
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <p
                      className="num text-3xl font-extrabold tracking-tight sm:text-4xl"
                      aria-live="polite"
                    >
                      {balanceVisible ? formatCurrency(wallet.balance, currency) : "••••••"}
                    </p>
                    <button
                      type="button"
                      onClick={toggleBalance}
                      aria-pressed={!balanceVisible}
                      aria-label={balanceVisible ? "Hide balance" : "Show balance"}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 text-white/70 transition hover:bg-white/10 hover:text-white"
                    >
                      {balanceVisible ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[11.5px] text-white/55">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-2.5 py-1 font-bold">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          wallet.isActive ? "bg-emerald-400" : "bg-red-400"
                        }`}
                        aria-hidden="true"
                      />
                      {wallet.isActive ? "Active wallet" : "Inactive wallet"}
                    </span>
                    <span>
                      {currency} · opened {formatDateTime(wallet.createdAt)}
                    </span>
                  </div>
                </div>
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-white/80">
                  <WalletCards size={20} />
                </span>
              </div>

              <div className="relative mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {historyLoading && !summary ? (
                  Array.from({ length: 4 }, (_, index) => (
                    <div
                      key={index}
                      className="h-[62px] animate-pulse rounded-lg bg-white/10"
                      aria-hidden="true"
                    />
                  ))
                ) : (
                  <>
                    <div className="rounded-lg bg-white/[0.06] px-3.5 py-2.5">
                      <p className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-white/45">
                        Incoming
                      </p>
                      <p className="num mt-1 text-[13.5px] font-extrabold text-emerald-300">
                        {summary ? formatCurrency(summary.incomingAmount, currency) : "—"}
                      </p>
                    </div>
                    <div className="rounded-lg bg-white/[0.06] px-3.5 py-2.5">
                      <p className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-white/45">
                        Outgoing
                      </p>
                      <p className="num mt-1 text-[13.5px] font-extrabold text-white">
                        {summary ? formatCurrency(summary.outgoingAmount, currency) : "—"}
                      </p>
                    </div>
                    <div className="rounded-lg bg-white/[0.06] px-3.5 py-2.5">
                      <p className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-white/45">
                        Activity
                      </p>
                      <p className="num mt-1 text-[13.5px] font-extrabold text-white">
                        {summary ? `${summary.total} record${summary.total === 1 ? "" : "s"}` : "—"}
                      </p>
                    </div>
                    <div className="rounded-lg bg-white/[0.06] px-3.5 py-2.5">
                      <p className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-white/45">
                        Verification
                      </p>
                      <p className="mt-1.5">
                        <StatusBadge value={kyc?.status} fallback="Not started" />
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>
          </section>

          <section className="card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-extrabold text-midnight">Quick actions</h2>
                <p className="mt-0.5 text-[12px] text-muted">
                  Move money or review your full history.
                </p>
              </div>
              <Link
                to="/transactions"
                className="inline-flex items-center gap-1 text-[12px] font-bold text-brand-700 transition hover:text-brand-800"
              >
                View transactions <ArrowRight size={13} />
              </Link>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              <QuickAction
                to="/payments#deposit"
                icon={ArrowDownToLine}
                label="Deposit"
                hint="Fund through Chapa test mode"
                disabled={!wallet.isActive || !approved}
              />
              <QuickAction
                to="/payments#withdraw"
                icon={ArrowUpFromLine}
                label="Withdraw"
                hint="Reserve and cancel payouts"
                disabled={!wallet.isActive || !approved}
              />
              <QuickAction
                to="/transfers"
                icon={Send}
                label="Send money"
                hint="Transfer to another wallet"
                disabled={!wallet.isActive || !approved}
              />
              <QuickAction
                to="/transactions"
                icon={ArrowLeftRight}
                label="Transactions"
                hint="Search, filter and inspect"
              />
            </div>
            {!approved ? (
              <p className="mt-3 flex items-center gap-1.5 text-[11.5px] font-semibold text-warning">
                <LockKeyhole size={12} />
                Locked actions unlock when your identity verification is approved.
              </p>
            ) : null}
          </section>

          <section className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
              <div>
                <h2 className="text-[15px] font-extrabold text-midnight">Recent activity</h2>
                <p className="mt-0.5 text-[12px] text-muted">
                  Latest wallet entries with their type and posting status.
                </p>
              </div>
              <Link
                to="/transactions"
                className="inline-flex items-center gap-1 text-[12px] font-bold text-brand-700 transition hover:text-brand-800"
              >
                Full history <ArrowRight size={13} />
              </Link>
            </div>

            {historyError ? (
              <div className="px-5 py-4">
                <Alert tone="error">
                  {historyError}
                  <button
                    type="button"
                    onClick={() => setRefreshKey((current) => current + 1)}
                    className="ml-2 underline underline-offset-2"
                  >
                    Retry
                  </button>
                </Alert>
              </div>
            ) : null}

            {historyLoading && transactions.length === 0 ? (
              <div className="space-y-3 px-5 py-5" role="status" aria-label="Loading activity">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : transactions.length === 0 ? (
              <div className="px-5 py-10">
                <EmptyState
                  className="border-none shadow-none"
                  icon={ArrowLeftRight}
                  title="No wallet activity yet"
                  description="Deposits and transfers will appear here once they are posted to your wallet."
                />
              </div>
            ) : (
              <ul className="divide-y divide-ink-100">
                {transactions.map((transaction) => {
                  const outgoing = transaction.sourceWalletId === wallet.id;
                  return (
                    <li key={transaction.id}>
                      <Link
                        to={`/transactions/${transaction.reference}`}
                        className="flex items-center gap-3 px-5 py-3.5 transition hover:bg-ink-50"
                      >
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                            outgoing ? "bg-ink-100 text-muted" : "bg-[#ecfdf3] text-success"
                          }`}
                        >
                          {outgoing ? <ArrowUpRight size={16} /> : <ArrowDownLeft size={16} />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[13px] font-bold text-midnight">
                              {outgoing ? "Sent" : "Received"}{" "}
                              {titleCase(transaction.type).toLowerCase()}
                            </p>
                            <StatusBadge value={transaction.status} />
                          </div>
                          <p className="mt-0.5 truncate text-[11.5px] text-muted">
                            {formatDateTime(transaction.createdAt)} ·{" "}
                            <span className="font-mono">{transaction.reference}</span>
                          </p>
                        </div>
                        <p
                          className={`num shrink-0 text-[13px] font-extrabold ${
                            outgoing ? "text-midnight" : "text-success"
                          }`}
                        >
                          {outgoing ? "−" : "+"}
                          {formatCurrency(transaction.amount, transaction.currency || currency)}
                        </p>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <ShieldCheck size={19} className="mt-0.5 shrink-0 text-brand-700" />
              <div>
                <h2 className="text-[15px] font-extrabold text-midnight">
                  Server-authoritative balances
                </h2>
                <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-muted">
                  Your wallet balance is projected from double-entry ledger accounts. The interface
                  never changes a balance on its own; every deposit, transfer, and withdrawal is
                  confirmed by the backend first.
                </p>
              </div>
            </div>
            <Link to="/transactions" className="btn-ghost shrink-0">
              <ArrowLeftRight size={15} /> Open history
            </Link>
          </section>
        </>
      ) : (
        <div className="space-y-4">
          {createError ? <Alert tone="error">{createError}</Alert> : null}
          <EmptyState
            icon={WalletCards}
            title="Create your ETB wallet"
            description={
              approved
                ? "Your wallet starts at zero. Create it now to receive transfers, deposits, and payouts."
                : "Your ETB wallet becomes available once identity verification is approved. You can start or review verification now."
            }
            actionLabel={
              approved ? (creating ? "Creating wallet…" : "Create wallet") : kycGuidance.nextLabel
            }
            actionTo={approved ? undefined : kycGuidance.nextTo}
            actionDisabled={creating}
            onAction={approved ? handleCreateWallet : undefined}
          />
        </div>
      )}
    </div>
  );
}
