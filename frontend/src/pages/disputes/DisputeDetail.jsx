import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CircleDot } from "lucide-react";
import PageHeader from "../../components/ui/PageHeader";
import Alert from "../../components/ui/Alert";
import StatusBadge from "../../components/ui/StatusBadge";
import { LoadingBlock } from "../../components/ui/Spinner";
import { getMyDispute } from "../../services/disputesService";
import { normalizeApiError } from "../../utils/apiError";
import { formatCurrency, formatDateTime, titleCase } from "../../utils/format";

const OUTCOME_TONE = {
  RESOLVED: "success",
  REJECTED: "error",
  UNDER_REVIEW: "info",
  OPEN: "warning",
};

export default function DisputeDetail() {
  const { reference } = useParams();
  const [dispute, setDispute] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const data = await getMyDispute(reference);
        if (active) {
          setDispute(data.dispute);
          setError("");
        }
      } catch (requestError) {
        if (active) setError(normalizeApiError(requestError).message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [reference]);

  if (loading) return <LoadingBlock label="Loading dispute…" />;
  if (error || !dispute) {
    return (
      <div className="space-y-4">
        <Alert tone="error">{error || "Dispute not found."}</Alert>
        <Link to="/disputes" className="btn-ghost">
          Back to disputes
        </Link>
      </div>
    );
  }

  const tone = OUTCOME_TONE[dispute.status] || "info";

  return (
    <div className="space-y-6">
      <PageHeader
        backTo="/disputes"
        backLabel="All disputes"
        eyebrow="Dispute case"
        title={titleCase(dispute.reason)}
        description={`Opened ${formatDateTime(dispute.openedAt)} · reference ${dispute.reference}`}
        actions={<StatusBadge value={dispute.status} />}
      />

      <Alert tone={tone}>
        {dispute.status === "OPEN"
          ? "Your dispute is queued for a financial officer. No funds have moved while it is being reviewed."
          : dispute.status === "UNDER_REVIEW"
            ? "A financial officer is reviewing the ledger entry. You will be notified when a decision is recorded."
            : dispute.status === "RESOLVED"
              ? `Resolved${
                  dispute.resolvedAmount
                    ? ` with ${formatCurrency(dispute.resolvedAmount, dispute.transaction?.currency)}`
                    : ""
                }. See the officer note below.`
              : "This dispute was rejected. See the officer note below for the reason."}
      </Alert>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="card space-y-4 p-5 sm:p-6">
          <h2 className="text-[15px] font-extrabold text-midnight">Your statement</h2>
          <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-body">
            {dispute.description}
          </p>
          {dispute.resolution ? (
            <>
              <h2 className="pt-2 text-[15px] font-extrabold text-midnight">Officer decision</h2>
              <p className="whitespace-pre-line rounded-lg border border-ink-200 bg-ink-50 p-4 text-[13.5px] leading-relaxed text-body">
                {dispute.resolution}
              </p>
            </>
          ) : null}
        </section>

        <section className="space-y-4">
          <div className="card p-5">
            <h2 className="text-[13px] font-extrabold text-midnight">Transaction</h2>
            {dispute.transaction ? (
              <dl className="mt-3 space-y-2 text-[12.5px]">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted">Amount</dt>
                  <dd className="num font-extrabold text-midnight">
                    {formatCurrency(dispute.transaction.amount, dispute.transaction.currency)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted">Type</dt>
                  <dd className="font-semibold text-body">{titleCase(dispute.transaction.type)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted">Ledger status</dt>
                  <dd>
                    <StatusBadge value={dispute.transaction.status} />
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted">Posted</dt>
                  <dd className="font-semibold text-body">
                    {formatDateTime(dispute.transaction.createdAt)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted">Reference</dt>
                  <dd>
                    <Link
                      to={`/transactions/${dispute.transaction.reference}`}
                      className="block max-w-[150px] truncate font-mono text-[11px] font-bold text-brand-700 hover:underline"
                    >
                      {dispute.transaction.reference}
                    </Link>
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="mt-2 text-[12.5px] text-muted">Transaction details are unavailable.</p>
            )}
          </div>

          <div className="card p-5">
            <h2 className="text-[13px] font-extrabold text-midnight">Case timeline</h2>
            <ol className="mt-3 space-y-3">
              {(dispute.events || []).map((event) => (
                <li key={event.id} className="flex gap-3">
                  <CircleDot size={14} className="mt-1 shrink-0 text-brand-600" />
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-bold text-midnight">
                      {titleCase(event.type.replace(/^STATUS_/, ""))}
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-muted">
                      {formatDateTime(event.createdAt)}
                    </p>
                    {event.note ? (
                      <p className="mt-1 text-[12.5px] leading-relaxed text-body">{event.note}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
            {dispute.assignedTo ? (
              <p className="mt-3 text-[11.5px] text-muted">Assigned to: {dispute.assignedTo}</p>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
