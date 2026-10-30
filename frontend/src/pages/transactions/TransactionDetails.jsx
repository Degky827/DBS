import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Printer,
  RefreshCw,
} from "lucide-react";
import Alert from "../../components/ui/Alert";
import EmptyState from "../../components/ui/EmptyState";
import StatusBadge from "../../components/ui/StatusBadge";
import { Skeleton } from "../../components/ui/Spinner";
import { useAccount } from "../../context/AccountContext";
import { getMyTransaction } from "../../services/walletService";
import { normalizeApiError } from "../../utils/apiError";
import { formatCurrency, formatDateTime, titleCase } from "../../utils/format";

const STATUS_HINT = {
  POSTED: "Funds are settled and reflected in your wallet balance.",
  PARTIALLY_REVERSED: "Part of this entry was reversed after posting.",
  REVERSED: "This entry was fully reversed; the funds returned to the source wallet.",
};

function DetailRow({ label, children, mono }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-ink-100 py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd
        className={`text-[13px] font-semibold text-midnight sm:text-right ${
          mono ? "break-all font-mono text-[12px]" : ""
        }`}
      >
        {children}
      </dd>
    </div>
  );
}

export default function TransactionDetails() {
  const { reference } = useParams();
  const { wallet } = useAccount();
  const [transaction, setTransaction] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError("");
      setNotFound(false);
      try {
        const result = await getMyTransaction(reference);
        if (active) setTransaction(result);
      } catch (requestError) {
        if (!active) return;
        if (requestError?.response?.status === 404) {
          setNotFound(true);
        } else {
          setError(normalizeApiError(requestError).message);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [reference, refreshKey]);

  const currency = transaction?.currency || wallet?.currency || "ETB";
  const directionKnown = Boolean(wallet && transaction);
  const outgoing = Boolean(directionKnown && transaction.sourceWalletId === wallet.id);
  const fee = Number(transaction?.feeAmount || 0);
  const reversed = Number(transaction?.reversedAmount || 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 print:hidden">
        <div>
          <Link
            to="/transactions"
            className="link mb-2 inline-flex items-center gap-1.5 text-[13px]"
          >
            <ArrowLeft size={13} /> Back to transactions
          </Link>
          <p className="eyebrow">Transaction receipt</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-midnight sm:text-[28px]">
            Transaction details
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">
            A server-recorded view of a single ledger-backed wallet entry.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setRefreshKey((current) => current + 1)}
            disabled={loading}
            className="btn-ghost"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            disabled={!transaction}
            className="btn-primary"
          >
            <Printer size={15} /> Print receipt
          </button>
        </div>
      </div>

      {error ? (
        <Alert tone="error">
          {error}
          <button
            type="button"
            onClick={() => setRefreshKey((current) => current + 1)}
            className="ml-2 underline underline-offset-2"
          >
            Retry
          </button>
        </Alert>
      ) : null}

      {loading ? (
        <div className="card space-y-4 p-6" role="status" aria-label="Loading transaction">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ) : notFound ? (
        <EmptyState
          icon={ArrowLeftRight}
          title="Transaction not found"
          description="This reference does not match an entry involving your wallet. Check the reference or return to the history list."
          actionLabel="Back to transactions"
          actionTo="/transactions"
        />
      ) : transaction ? (
        <section className="card mx-auto w-full max-w-2xl overflow-hidden print:max-w-none print:border-0 print:shadow-none">
          <div className="border-b border-ink-100 px-5 py-4 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted">
                Meridian · ETB wallet
              </p>
              <StatusBadge value={transaction.status} />
            </div>
            <div className="mt-4 flex items-center gap-4">
              <span
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                  directionKnown && !outgoing
                    ? "bg-[#ecfdf3] text-success"
                    : "bg-ink-100 text-midnight"
                }`}
              >
                {directionKnown && !outgoing ? (
                  <ArrowDownLeft size={20} />
                ) : (
                  <ArrowUpRight size={20} />
                )}
              </span>
              <div>
                <p className="text-[12px] font-semibold text-muted">
                  {directionKnown ? (outgoing ? "Sent" : "Received") : "Wallet"}{" "}
                  {titleCase(transaction.type).toLowerCase()}
                </p>
                <p
                  className={`num mt-0.5 text-2xl font-extrabold ${
                    directionKnown && !outgoing ? "text-success" : "text-midnight"
                  }`}
                >
                  {directionKnown ? (outgoing ? "−" : "+") : ""}
                  {formatCurrency(transaction.amount, currency)}
                </p>
              </div>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              {STATUS_HINT[transaction.status] ||
                "This entry has been recorded by the wallet service."}
            </p>
          </div>

          <dl className="px-5 py-2 sm:px-6">
            <DetailRow label="Reference" mono>
              {transaction.reference}
            </DetailRow>
            <DetailRow label="Ledger entry" mono>
              {transaction.ledgerEntryReference || "—"}
            </DetailRow>
            <DetailRow label="Recorded">{formatDateTime(transaction.createdAt)}</DetailRow>
            <DetailRow label="Type">{titleCase(transaction.type)}</DetailRow>
            <DetailRow label="Direction">
              {directionKnown ? (outgoing ? "Outgoing" : "Incoming") : "—"}
            </DetailRow>
            <DetailRow label="Amount">{formatCurrency(transaction.amount, currency)}</DetailRow>
            {fee > 0 ? (
              <DetailRow label="Fee">{formatCurrency(transaction.feeAmount, currency)}</DetailRow>
            ) : null}
            {reversed > 0 ? (
              <DetailRow label="Reversed">
                {formatCurrency(transaction.reversedAmount, currency)}
              </DetailRow>
            ) : null}
            <DetailRow label="From wallet" mono>
              {transaction.sourceWalletId || "—"}
            </DetailRow>
            <DetailRow label="To wallet" mono>
              {transaction.destinationWalletId || "—"}
            </DetailRow>
          </dl>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 bg-ink-50/60 px-5 py-3.5 sm:px-6">
            <p className="text-[11px] leading-relaxed text-muted">
              Generated {new Date().toLocaleString("en-US")} · Figures come directly from the
              ledger-backed wallet service.
            </p>
            <Link
              to="/transactions"
              className="inline-flex items-center gap-1 text-[12px] font-bold text-brand-700 hover:text-brand-800 print:hidden"
            >
              All transactions <ArrowLeftRight size={13} />
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}
