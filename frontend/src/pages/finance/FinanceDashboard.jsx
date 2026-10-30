import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeftRight,
  CheckCircle2,
  CreditCard,
  Undo2,
  WalletCards,
} from "lucide-react";
import {
  getFinancialAnalytics,
  listPlatformPayments,
  listPlatformTransactions,
} from "../../services/staffService";
import { normalizeApiError } from "../../utils/apiError";
import { formatCurrency, formatDateTime, titleCase } from "../../utils/format";
import PageHeader from "../../components/ui/PageHeader";
import Alert from "../../components/ui/Alert";
import StatusBadge from "../../components/ui/StatusBadge";
import StatCard from "../../components/staff/StatCard";
import TrendChart from "../../components/staff/TrendChart";
import DistributionList from "../../components/staff/DistributionList";
import PeriodSelect from "../../components/staff/PeriodSelect";
import { Spinner } from "../../components/ui/Spinner";

const number = new Intl.NumberFormat("en-US");
const shortDate = (iso) => {
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const statusItems = (rows) =>
  (rows ?? []).map((row) => ({
    label: titleCase(row.value),
    value: row.count,
    tone:
      row.value === "COMPLETED" || row.value === "POSTED"
        ? "success"
        : row.value === "FAILED"
          ? "danger"
          : row.value === "PENDING" || row.value === "PARTIALLY_REVERSED"
            ? "warning"
            : "neutral",
  }));

export default function FinanceDashboard() {
  const [days, setDays] = useState(30);
  const [analytics, setAnalytics] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      const [analyticsResult, txResult, paymentResult] = await Promise.allSettled([
        getFinancialAnalytics({ days }),
        listPlatformTransactions({ limit: 6 }),
        listPlatformPayments({ limit: 6 }),
      ]);
      if (!active) return;
      if (analyticsResult.status === "fulfilled") setAnalytics(analyticsResult.value);
      if (txResult.status === "fulfilled") setTransactions(txResult.value.transactions);
      if (paymentResult.status === "fulfilled") setPayments(paymentResult.value.payments);
      const failure = [analyticsResult, txResult, paymentResult].find(
        (result) => result.status === "rejected"
      );
      if (failure) setError(normalizeApiError(failure.reason).message);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [days]);

  const changePeriod = (nextDays) => {
    if (nextDays === days) return;
    setLoading(true);
    setDays(nextDays);
  };

  const transactionCount = (analytics?.transactionsByDay ?? []).reduce(
    (sum, point) => sum + point.count,
    0
  );
  const volumes = analytics?.volumeByCurrency ?? [];
  const volumeValue =
    volumes.length === 0
      ? "—"
      : volumes.length === 1
        ? formatCurrency(volumes[0].amount, volumes[0].currency)
        : `${volumes.length} currencies`;

  const paymentStatuses = analytics?.paymentStatus ?? [];
  const paymentTotal = paymentStatuses.reduce((sum, row) => sum + row.count, 0);
  const completed = paymentStatuses.find((row) => row.value === "COMPLETED")?.count ?? 0;
  const pending = paymentStatuses.find((row) => row.value === "PENDING")?.count ?? 0;
  const failed = paymentStatuses.find((row) => row.value === "FAILED")?.count ?? 0;
  const successRate = paymentTotal ? ((completed / paymentTotal) * 100).toFixed(1) : null;

  const pendingWithdrawals = (analytics?.withdrawals?.byStatus ?? [])
    .filter((row) => row.value === "PENDING")
    .reduce((sum, row) => sum + row.count, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finance"
        title="Financial operations"
        description="Posted ledger volume, payment outcomes and reversal activity for the selected period. Every figure is aggregated by the server from persisted records."
        actions={<PeriodSelect value={days} onChange={changePeriod} />}
      />

      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={`Transactions · ${days}d`}
          value={loading ? "—" : number.format(transactionCount)}
          hint="Ledger transactions created in the period"
          icon={ArrowLeftRight}
          tone="brand"
          loading={loading}
        />
        <StatCard
          label="Transaction volume"
          value={loading ? "—" : volumeValue}
          hint="Principal amount by currency"
          icon={WalletCards}
          tone="navy"
          loading={loading}
        />
        <StatCard
          label="Payment success rate"
          value={loading ? "—" : successRate === null ? "—" : `${successRate}%`}
          hint={`${completed} completed · ${pending} pending · ${failed} failed`}
          icon={CheckCircle2}
          tone="success"
          loading={loading}
        />
        <StatCard
          label={`Reversals · ${days}d`}
          value={loading ? "—" : number.format(analytics?.reversals?.count ?? 0)}
          hint={`${pendingWithdrawals} withdrawal${pendingWithdrawals === 1 ? "" : "s"} pending`}
          icon={Undo2}
          tone="warning"
          loading={loading}
        />
      </div>

      {loading ? (
        <div className="card flex items-center justify-center gap-2 px-5 py-20 text-[13px] font-semibold text-ink-500">
          <Spinner size={16} className="text-brand-600" /> Loading financial activity…
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <TrendChart
              title="Transactions per day"
              description="Count of ledger transactions created each day"
              data={(analytics?.transactionsByDay ?? []).map((point) => ({
                label: shortDate(point.date),
                value: point.count,
              }))}
              formatValue={(value) => number.format(value)}
            />
            <TrendChart
              title="Completed payments per day"
              description="Payments reaching COMPLETED status each day"
              data={(analytics?.paymentsByDay ?? []).map((point) => ({
                label: shortDate(point.date),
                value: point.completed,
              }))}
              formatValue={(value) => number.format(value)}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <DistributionList
              title="Transaction types"
              description="Posted activity by type"
              items={statusItems(analytics?.transactionTypes)}
            />
            <DistributionList
              title="Transaction status"
              description="Status of transactions in the period"
              items={statusItems(analytics?.transactionStatus)}
            />
            <DistributionList
              title="Payment status"
              description="Outcome of payments in the period"
              items={statusItems(paymentStatuses)}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
                <div>
                  <h2 className="text-[15px] font-extrabold text-midnight">Recent transactions</h2>
                  <p className="mt-0.5 text-[12px] text-muted">Latest posted ledger activity.</p>
                </div>
                <Link to="/finance/transactions" className="link text-[12px]">
                  All transactions
                </Link>
              </div>
              {transactions.length === 0 ? (
                <p className="px-5 py-10 text-center text-[13px] text-muted">
                  No transactions recorded yet.
                </p>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {transactions.map((transaction) => (
                    <li key={transaction.id}>
                      <Link
                        to={`/finance/transactions/${transaction.reference}`}
                        className="flex items-center justify-between gap-3 px-5 py-3 transition hover:bg-ink-50"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[12.5px] font-semibold text-midnight">
                            {titleCase(transaction.type)} ·{" "}
                            {formatCurrency(transaction.amount, transaction.currency)}
                          </p>
                          <p className="truncate font-mono text-[10.5px] text-muted">
                            {transaction.reference}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <StatusBadge value={transaction.status} />
                          <p className="mt-1 text-[10.5px] text-muted">
                            {formatDateTime(transaction.createdAt)}
                          </p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card overflow-hidden">
              <div className="border-b border-ink-100 px-5 py-4">
                <h2 className="text-[15px] font-extrabold text-midnight">Recent payments</h2>
                <p className="mt-0.5 text-[12px] text-muted">
                  Provider payments and their latest known state.
                </p>
              </div>
              {payments.length === 0 ? (
                <p className="px-5 py-10 text-center text-[13px] text-muted">
                  No payments recorded yet.
                </p>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {payments.map((payment) => (
                    <li key={payment.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-[12.5px] font-semibold text-midnight">
                          {formatCurrency(payment.amount, payment.currency)} ·{" "}
                          {titleCase(payment.provider)}
                        </p>
                        <p className="truncate font-mono text-[10.5px] text-muted">
                          {payment.reference}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <StatusBadge value={payment.status} />
                        <p className="mt-1 text-[10.5px] text-muted">
                          {formatDateTime(payment.createdAt)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <Alert tone="info">
            Fraud and anomaly alerting is not available: the platform has no fraud-detection
            engine or alerts endpoint, so no alert feed is shown.
          </Alert>

          <p className="flex items-center gap-2 text-[12px] text-muted">
            <CreditCard size={14} /> Amounts are transaction volume, not bank revenue. Fees are
            reported separately on the reports page.
          </p>
        </>
      )}
    </div>
  );
}
