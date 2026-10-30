import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Lock } from "lucide-react";
import { getPlatformTransaction } from "../../services/staffService";
import { normalizeApiError } from "../../utils/apiError";
import { formatCurrency, formatDate, formatDateTime, titleCase } from "../../utils/format";
import PageHeader from "../../components/ui/PageHeader";
import Alert from "../../components/ui/Alert";
import StatusBadge from "../../components/ui/StatusBadge";
import { Spinner } from "../../components/ui/Spinner";

const party = (value) =>
  value ? [value.firstName, value.lastName].filter(Boolean).join(" ") || value.email : "—";

const Row = ({ label, value, mono }) => (
  <div>
    <dt className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink-400">{label}</dt>
    <dd className={`mt-0.5 text-[12.5px] font-semibold text-body ${mono ? "break-all font-mono" : ""}`}>
      {value || "—"}
    </dd>
  </div>
);

export default function FinanceTransactionDetail() {
  const { reference } = useParams();
  const [transaction, setTransaction] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await getPlatformTransaction(reference);
        if (!active) return;
        setTransaction(data.transaction);
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
  }, [reference]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-[13px] font-semibold text-ink-500">
        <Spinner size={18} className="text-brand-600" /> Loading transaction…
      </div>
    );
  }

  if (error || !transaction) {
    return (
      <div className="space-y-4">
        <PageHeader
          eyebrow="Finance"
          title="Transaction detail"
          backTo="/finance/transactions"
          backLabel="Back to transactions"
        />
        <Alert tone="error">{error || "This transaction could not be loaded."}</Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finance"
        title="Transaction detail"
        description="Reconciliation view of a single ledger transaction. Finance access is read-only; reversals and ledger corrections are made through their own controlled processes."
        backTo="/finance/transactions"
        backLabel="Back to transactions"
        actions={
          <span className="badge-neutral inline-flex items-center gap-1.5">
            <Lock size={12} /> Read-only
          </span>
        }
      />

      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="break-all font-mono text-[13px] font-semibold text-midnight">
              {transaction.reference}
            </p>
            <p className="mt-1 text-[12.5px] text-muted">
              {titleCase(transaction.type)} · {formatDateTime(transaction.createdAt)}
            </p>
          </div>
          <StatusBadge value={transaction.status} />
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
          <Row
            label="Amount"
            value={formatCurrency(transaction.amount, transaction.currency)}
          />
          <Row label="Fee" value={formatCurrency(transaction.feeAmount, transaction.currency)} />
          <Row
            label="Reversed amount"
            value={formatCurrency(transaction.reversedAmount, transaction.currency)}
          />
          <Row label="Currency" value={transaction.currency} />
          <Row label="Business date" value={formatDate(transaction.businessDate)} />
          <Row label="Created" value={formatDateTime(transaction.createdAt)} />
          <Row label="Initiated by" value={party(transaction.initiatedBy)} />
          <Row label="Initiator email" value={transaction.initiatedBy?.email} />
        </dl>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="text-[15px] font-extrabold text-midnight">Ledger and parties</h2>
          <p className="mt-0.5 text-[12px] text-muted">
            Wallet references identify the accounts debited and credited by the journal entry.
          </p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <Row label="Journal reference" value={transaction.journalEntry?.reference} mono />
            <Row label="Journal status" value={titleCase(transaction.journalEntry?.status)} />
            <Row label="Event type" value={titleCase(transaction.journalEntry?.eventType)} />
            <Row
              label="Posted at"
              value={
                transaction.journalEntry?.postedAt
                  ? formatDateTime(transaction.journalEntry.postedAt)
                  : "—"
              }
            />
            <Row label="Source wallet" value={transaction.sourceWallet?.id} mono />
            <Row label="Source customer" value={transaction.sourceWallet?.userId} mono />
            <Row label="Destination wallet" value={transaction.destinationWallet?.id} mono />
            <Row label="Destination customer" value={transaction.destinationWallet?.userId} mono />
          </dl>
        </section>

        <section className="card p-5">
          <h2 className="text-[15px] font-extrabold text-midnight">Payment and provider</h2>
          <p className="mt-0.5 text-[12px] text-muted">
            Provider detail is shown when the transaction was funded by a provider payment.
          </p>
          {transaction.payment ? (
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <Row label="Payment reference" value={transaction.payment.reference} mono />
              <Row label="Provider" value={titleCase(transaction.payment.provider)} />
              <Row label="Provider reference" value={transaction.payment.providerRef} mono />
              <Row label="Payment status" value={titleCase(transaction.payment.status)} />
              <div className="sm:col-span-2">
                <dt className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink-400">
                  Provider failure reason
                </dt>
                <dd className="mt-0.5 text-[12.5px] text-body">
                  {transaction.payment.failureReason || "No failure recorded."}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="py-8 text-center text-[13px] text-muted">
              This transaction is not linked to a provider payment.
            </p>
          )}
        </section>
      </div>

      <section className="card overflow-hidden">
        <div className="border-b border-ink-100 px-5 py-4">
          <h2 className="text-[15px] font-extrabold text-midnight">Reversals</h2>
          <p className="mt-0.5 text-[12px] text-muted">
            Append-only reversal records linked to this transaction.
          </p>
        </div>
        {(transaction.reversals ?? []).length === 0 ? (
          <p className="px-5 py-10 text-center text-[13px] text-muted">
            No reversals have been recorded for this transaction.
          </p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {transaction.reversals.map((reversal) => (
              <li key={reversal.reference} className="px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-[12px] font-semibold text-midnight">
                    {reversal.reference}
                  </p>
                  <p className="num text-[12.5px] font-bold text-midnight">
                    {formatCurrency(reversal.amount, reversal.currency)}
                  </p>
                </div>
                <p className="mt-1 text-[12.5px] text-body">{reversal.reason}</p>
                <p className="mt-1 break-all text-[11px] text-muted">
                  Actor {reversal.actorUserId} · {formatDateTime(reversal.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
