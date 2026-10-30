import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  CreditCard,
  LockKeyhole,
  RefreshCw,
  Send,
  ShieldCheck,
  UserRound,
  WalletCards,
} from "lucide-react";
import Alert from "../../components/ui/Alert";
import StatusBadge from "../../components/ui/StatusBadge";
import { Skeleton } from "../../components/ui/Spinner";
import { useAccount } from "../../context/AccountContext";
import { listMyTransactions } from "../../services/walletService";
import { normalizeApiError } from "../../utils/apiError";
import {
  formatCurrency,
  formatDateTime,
  greetingForNow,
  titleCase,
  todayLong,
} from "../../utils/format";
import { isKycApproved, kycCopy } from "../../utils/kyc";

const DIRECTIONS = [
  { value: "all", label: "All", ariaLabel: "All transactions" },
  { value: "incoming", label: "In", ariaLabel: "Incoming transactions" },
  { value: "outgoing", label: "Out", ariaLabel: "Outgoing transactions" },
];

function SummaryCard({ icon: Icon, label, value, hint, to, actionLabel, busy, tone = "brand" }) {
  const toneClass =
    tone === "success"
      ? "bg-[#ecfdf3] text-success"
      : tone === "warning"
        ? "bg-[#fffbeb] text-warning"
        : tone === "danger"
          ? "bg-[#fef2f2] text-danger"
          : "bg-brand-50 text-brand-700";

  return (
    <div className="card flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${toneClass}`}>
          <Icon size={18} />
        </span>
        {to ? (
          <Link
            to={to}
            className="inline-flex items-center gap-1 text-[12px] font-bold text-brand-700 transition hover:text-brand-800"
          >
            {actionLabel || "View"} <ArrowRight size={13} />
          </Link>
        ) : null}
      </div>
      <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.14em] text-muted">{label}</p>
      {busy ? (
        <Skeleton className="mt-2 h-7 w-32" />
      ) : (
        <p className="num mt-1 text-2xl font-extrabold tracking-tight text-midnight">{value}</p>
      )}
      <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{hint}</p>
    </div>
  );
}

function QuickAction({ to, icon: Icon, label, hint, locked }) {
  return (
    <Link
      to={to}
      className="group flex items-start gap-3 rounded-xl border border-ink-200 bg-white p-3.5 transition hover:border-brand-600/40 hover:bg-brand-50/40"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink-50 text-muted transition group-hover:bg-brand-50 group-hover:text-brand-700">
        <Icon size={17} />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-[13px] font-bold text-midnight">
          {label}
          {locked ? <LockKeyhole size={12} className="text-warning" /> : null}
        </span>
        <span className="mt-0.5 block text-[11px] leading-snug text-muted">{hint}</span>
      </span>
    </Link>
  );
}

export default function Dashboard() {
  const authUser = useSelector((state) => state.auth.user);
  const {
    profile,
    wallet,
    kyc,
    loading: accountLoading,
    profileError,
    walletError,
    kycUnavailable,
    refresh,
  } = useAccount();

  const [direction, setDirection] = useState("all");
  const [transactions, setTransactions] = useState([]);
  const [page, setPage] = useState(null);
  const [txLoading, setTxLoading] = useState(true);
  const [txError, setTxError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (accountLoading || !wallet) return undefined;

    let active = true;
    (async () => {
      setTxLoading(true);
      setTxError("");
      try {
        const result = await listMyTransactions({ limit: 5, direction });
        if (!active) return;
        setTransactions(result.transactions || []);
        setPage(result.page || null);
      } catch (error) {
        if (active) setTxError(normalizeApiError(error).message);
      } finally {
        if (active) setTxLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [accountLoading, wallet, direction, refreshKey]);

  const firstName = profile?.firstName || authUser?.firstName || "";
  const fullName = [
    profile?.firstName || authUser?.firstName,
    profile?.lastName || authUser?.lastName,
  ]
    .filter(Boolean)
    .join(" ");
  const approved = isKycApproved(kyc);
  const copy = kycCopy(kyc);
  const emailVerified = authUser?.isEmailVerified;
  const transactionTotal = page?.total ?? transactions.length;
  const isRefreshing = accountLoading || (Boolean(wallet) && txLoading);

  const handleRefresh = () => {
    refresh({ silent: true });
    setRefreshKey((current) => current + 1);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow">{greetingForNow()}</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-midnight sm:text-[28px]">
            {firstName ? `${firstName}, here is your account` : "Your account"}
          </h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <span>{todayLong()}</span>
            <span
              className="hidden h-1 w-1 rounded-full bg-ink-300 sm:inline-block"
              aria-hidden="true"
            />
            <span>{profile?.email || authUser?.email}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="btn-ghost"
          >
            <RefreshCw size={15} className={isRefreshing ? "animate-spin" : ""} /> Refresh
          </button>
          <Link to={approved ? "/transfers" : "/kyc"} className="btn-primary">
            {approved ? <Send size={16} /> : <LockKeyhole size={16} />}
            {approved ? "Send money" : "Verify to send"}
          </Link>
        </div>
      </div>

      {profileError ? <Alert tone="warning">{profileError}</Alert> : null}
      {walletError ? <Alert tone="warning">{walletError}</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          icon={WalletCards}
          label="Available balance"
          value={wallet ? formatCurrency(wallet.balance, wallet.currency) : "No wallet yet"}
          hint={
            wallet
              ? wallet.isActive
                ? `${wallet.currency} wallet · active`
                : "Your wallet is currently inactive"
              : "Create a wallet to hold your balance"
          }
          to="/wallet"
          actionLabel={wallet ? "Wallet" : "Create"}
          busy={accountLoading}
          tone={wallet && !wallet.isActive ? "warning" : "brand"}
        />

        <SummaryCard
          icon={ArrowLeftRight}
          label="Transactions"
          value={!wallet ? "—" : txLoading ? "" : transactionTotal}
          hint={
            !wallet
              ? "Available after your wallet is created"
              : direction === "all"
                ? "Recorded incoming and outgoing transfers"
                : `Matching ${direction} transfers`
          }
          to="/transactions"
          actionLabel="View all"
          busy={accountLoading || (Boolean(wallet) && txLoading)}
          tone="brand"
        />

        <SummaryCard
          icon={ShieldCheck}
          label="Identity verification"
          value={accountLoading ? "" : kycUnavailable ? "Unavailable" : copy.label}
          hint={
            kycUnavailable
              ? "The verification service could not be reached"
              : kyc?.status === "APPROVED"
                ? "Your identity has been verified"
                : approved
                  ? "Verified"
                  : "Required for transfers and payments"
          }
          to="/kyc"
          actionLabel={kyc ? "Details" : "Start"}
          busy={accountLoading}
          tone={
            kyc?.status === "APPROVED"
              ? "success"
              : kyc?.status === "REJECTED"
                ? "danger"
                : "warning"
          }
        />

        <SummaryCard
          icon={approved ? BadgeCheck : LockKeyhole}
          label="Account access"
          value={accountLoading ? "" : approved ? "Full access" : "Limited"}
          hint={
            approved
              ? "Transfers, payments and wallet activity are enabled"
              : "Verify your identity to unlock transfers and payments"
          }
          to="/profile"
          actionLabel="Profile"
          busy={accountLoading}
          tone={approved ? "success" : "warning"}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <section className="card min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
            <div>
              <h2 className="text-[15px] font-extrabold text-midnight">Recent transactions</h2>
              <p className="mt-0.5 text-[12px] text-muted">
                Your latest incoming and outgoing wallet transfers.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div
                className="inline-flex rounded-lg border border-ink-200 bg-ink-50 p-0.5"
                role="group"
                aria-label="Filter recent transactions"
              >
                {DIRECTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-label={option.ariaLabel}
                    aria-pressed={direction === option.value}
                    onClick={() => setDirection(option.value)}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-bold transition ${
                      direction === option.value
                        ? "bg-white text-midnight shadow-sm"
                        : "text-muted hover:text-midnight"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <Link
                to="/transactions"
                className="hidden items-center gap-1 text-[12px] font-bold text-brand-700 transition hover:text-brand-800 sm:inline-flex"
              >
                View all <ArrowRight size={13} />
              </Link>
            </div>
          </div>

          {txError ? (
            <div className="px-5 py-4">
              <Alert tone="error">
                {txError}
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

          {accountLoading || (wallet && txLoading) ? (
            <div
              className="space-y-3 px-5 py-5"
              role="status"
              aria-label="Loading recent transactions"
            >
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : !wallet ? (
            <div className="px-5 py-10 text-center">
              <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                <WalletCards size={20} />
              </span>
              <p className="mt-3 text-sm font-bold text-midnight">Create a wallet first</p>
              <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-muted">
                Your transaction history will appear here once your ETB wallet exists.
              </p>
              <Link to="/wallet" className="btn-primary mt-4">
                Open wallet
              </Link>
            </div>
          ) : transactions.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-ink-50 text-muted">
                <ArrowLeftRight size={20} />
              </span>
              <p className="mt-3 text-sm font-bold text-midnight">
                {direction === "all" ? "No transactions yet" : `No ${direction} transactions`}
              </p>
              <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-muted">
                {direction === "all"
                  ? "Completed transfers will appear here with their reference and timestamp."
                  : "Try a different filter to see other activity."}
              </p>
              {approved && direction === "all" ? (
                <Link to="/transfers" className="btn-primary mt-4">
                  <Send size={15} /> Send money
                </Link>
              ) : null}
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="data-table min-w-[640px]">
                  <thead>
                    <tr>
                      <th scope="col">Reference</th>
                      <th scope="col">Date &amp; time</th>
                      <th scope="col">Description</th>
                      <th scope="col">Type</th>
                      <th scope="col" className="text-right">
                        Amount
                      </th>
                      <th scope="col" className="text-right">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((transaction) => {
                      const outgoing = transaction.sourceWalletId === wallet.id;
                      return (
                        <tr key={transaction.id}>
                          <td>
                            <span
                              className="block max-w-[130px] truncate font-mono text-[11px] text-muted"
                              title={transaction.reference}
                            >
                              {transaction.reference}
                            </span>
                          </td>
                          <td className="whitespace-nowrap text-[12.5px] text-body">
                            {formatDateTime(transaction.createdAt)}
                          </td>
                          <td className="whitespace-nowrap text-[13px] font-semibold text-midnight">
                            {outgoing ? "Internal transfer sent" : "Internal transfer received"}
                          </td>
                          <td className="text-[12.5px] text-muted">
                            {titleCase(transaction.type)}
                          </td>
                          <td
                            className={`num whitespace-nowrap text-right text-[13px] font-extrabold ${
                              outgoing ? "text-midnight" : "text-success"
                            }`}
                          >
                            {outgoing ? "−" : "+"}
                            {formatCurrency(
                              transaction.amount,
                              transaction.currency || wallet.currency
                            )}
                          </td>
                          <td className="text-right">
                            <StatusBadge value={transaction.status} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <ul className="divide-y divide-ink-100 md:hidden">
                {transactions.map((transaction) => {
                  const outgoing = transaction.sourceWalletId === wallet.id;
                  return (
                    <li key={transaction.id} className="flex items-start gap-3 px-4 py-3.5">
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
                            {outgoing ? "Sent transfer" : "Received transfer"}
                          </p>
                          <p
                            className={`num shrink-0 text-[13px] font-extrabold ${
                              outgoing ? "text-midnight" : "text-success"
                            }`}
                          >
                            {outgoing ? "−" : "+"}
                            {formatCurrency(
                              transaction.amount,
                              transaction.currency || wallet.currency
                            )}
                          </p>
                        </div>
                        <p className="mt-0.5 truncate text-[11.5px] text-muted">
                          {formatDateTime(transaction.createdAt)} ·{" "}
                          <span className="font-mono">{transaction.reference.slice(0, 8)}</span>
                        </p>
                        <div className="mt-1.5 flex items-center gap-2">
                          <StatusBadge value={transaction.status} />
                          <span className="text-[11px] text-muted">
                            {titleCase(transaction.type)}
                          </span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="border-t border-ink-100 px-5 py-3">
                <Link
                  to="/transactions"
                  className="inline-flex items-center gap-1 text-[12px] font-bold text-brand-700 transition hover:text-brand-800"
                >
                  View all transactions <ArrowRight size={13} />
                </Link>
              </div>
            </>
          )}
        </section>

        <div className="space-y-6">
          <section className="card p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                  Identity verification
                </p>
                <h2 className="mt-1 text-[15px] font-extrabold text-midnight">
                  {accountLoading
                    ? "Checking status"
                    : kycUnavailable
                      ? "Status unavailable"
                      : copy.headline}
                </h2>
              </div>
              {accountLoading ? (
                <Skeleton className="h-6 w-20" />
              ) : (
                <StatusBadge value={kyc?.status} fallback="Not started" />
              )}
            </div>

            <p className="mt-2 text-[13px] leading-relaxed text-muted">
              {kycUnavailable
                ? "We could not reach the verification service. Open the verification page to retry."
                : copy.description}
            </p>

            {kyc?.status === "REJECTED" && kyc.decisionReason ? (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] leading-relaxed text-red-700">
                <span className="font-bold">Decision reason:</span> {kyc.decisionReason}
              </div>
            ) : null}

            {kyc ? (
              <dl className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                {[
                  ["Provider check", kyc.providerStatus, "Not started"],
                  ["Document", kyc.documentVerificationStatus, "Pending"],
                  ["Profile match", kyc.dataComparisonStatus, "Pending"],
                  ["Face & liveness", kyc.faceMatchStatus || kyc.livenessStatus, "Pending"],
                ].map(([label, value, fallback]) => (
                  <div
                    key={label}
                    className="flex items-center justify-between gap-2 rounded-lg bg-ink-50 px-3 py-2"
                  >
                    <dt className="text-[12px] text-muted">{label}</dt>
                    <dd>
                      <StatusBadge value={value} fallback={fallback} />
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Link to={copy.nextTo} className="btn-primary py-2.5">
                {copy.nextLabel}
              </Link>
              {kyc ? (
                <Link to="/kyc/status" className="btn-ghost py-2.5">
                  Status timeline
                </Link>
              ) : null}
            </div>
          </section>

          <section className="card p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[15px] font-extrabold text-midnight">Quick actions</h2>
              <Link to="/profile" className="text-[12px] font-bold text-brand-700">
                Profile
              </Link>
            </div>
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-1">
              <QuickAction
                to="/wallet"
                icon={WalletCards}
                label="View wallet"
                hint={wallet ? "Balance, activity and funding" : "Create your ETB wallet"}
              />
              <QuickAction
                to={approved ? "/transfers" : "/kyc"}
                icon={approved ? Send : LockKeyhole}
                label="Send money"
                hint={approved ? "Internal wallet transfer" : "Verify your identity first"}
                locked={!approved}
              />
              <QuickAction
                to={approved ? "/payments" : "/kyc"}
                icon={approved ? CreditCard : LockKeyhole}
                label="Make a payment"
                hint={approved ? "Add money through Chapa test mode" : "Verify your identity first"}
                locked={!approved}
              />
              <QuickAction
                to="/transactions"
                icon={ArrowLeftRight}
                label="View transactions"
                hint="Full history with filters"
              />
              <QuickAction
                to="/kyc"
                icon={ShieldCheck}
                label={approved ? "Verification details" : "Complete KYC"}
                hint={approved ? "Your identity is verified" : "Unlock transfers and payments"}
              />
              <QuickAction
                to="/profile"
                icon={UserRound}
                label="View profile"
                hint={fullName ? fullName : "Complete your personal details"}
              />
            </div>
          </section>

          {emailVerified === false ? (
            <div className="rounded-xl border border-[#fde68a] bg-[#fffbeb] px-4 py-3.5">
              <p className="text-[13px] font-bold text-warning">Email not verified</p>
              <p className="mt-1 text-[12px] leading-relaxed text-[#92400e]">
                Confirm your email address to secure account recovery.
              </p>
              <Link
                to="/verify-email"
                state={{ email: profile?.email || authUser?.email }}
                className="mt-2 inline-flex items-center gap-1 text-[12px] font-bold text-warning underline underline-offset-4"
              >
                Verify email <ArrowRight size={12} />
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
