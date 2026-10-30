import { useEffect, useState } from "react";
import { ArrowLeftRight, Banknote, CreditCard, Undo2 } from "lucide-react";
import { getAdminAnalytics, getFinancialAnalytics } from "../../services/staffService";
import { normalizeApiError } from "../../utils/apiError";
import { formatCurrency, titleCase } from "../../utils/format";
import PageHeader from "../../components/ui/PageHeader";
import Alert from "../../components/ui/Alert";
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

const sumCounts = (rows) => rows.reduce((sum, row) => sum + (row.count ?? 0), 0);

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

export default function FinancialReports({ scope = "admin" }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const load = scope === "admin" ? getAdminAnalytics : getFinancialAnalytics;
    (async () => {
      try {
        const analytics = await load({ days });
        if (!active) return;
        setData(analytics);
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
  }, [days, scope]);

  const changePeriod = (nextDays) => {
    if (nextDays === days) return;
    setLoading(true);
    setDays(nextDays);
  };

  const transactionsByDay = (data?.transactionsByDay ?? []).map((point) => ({
    label: shortDate(point.date),
    value: point.count,
  }));
  const completedByDay = (data?.paymentsByDay ?? []).map((point) => ({
    label: shortDate(point.date),
    value: point.completed,
  }));

  const paymentStatuses = data?.paymentStatus ?? [];
  const paymentTotal = sumCounts(paymentStatuses);
  const completedCount =
    paymentStatuses.find((row) => row.value === "COMPLETED")?.count ?? 0;
  const failedCount = paymentStatuses.find((row) => row.value === "FAILED")?.count ?? 0;
  const successRate = paymentTotal ? (completedCount / paymentTotal) * 100 : null;
  const failureRate = paymentTotal ? (failedCount / paymentTotal) * 100 : null;
  const periodLabel = data?.period
    ? `${data.period.from} to ${data.period.to}`
    : `Last ${days} days`;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={scope === "admin" ? "Administration" : "Finance"}
        title="Financial reports"
        description="Volume, counts and status outcomes for the selected period, built from posted ledger transactions, payments and withdrawals. Amounts are transaction volume, not bank revenue."
        actions={<PeriodSelect value={days} onChange={changePeriod} />}
      />

      <Alert tone="info">
        Reporting period: <span className="font-bold">{periodLabel}</span>. Export is not offered
        because the platform has no authorized reporting-export endpoint; totals shown here are
        aggregated by the server and are safe to read on screen.
      </Alert>

      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={`Transactions · ${days}d`}
          value={loading ? "—" : number.format(sumCounts(data?.transactionsByDay))}
          hint="Ledger transactions created in the period"
          icon={ArrowLeftRight}
          tone="brand"
          loading={loading}
        />
        <StatCard
          label={`Payments · ${days}d`}
          value={loading ? "—" : number.format(paymentTotal)}
          hint={
            successRate === null
              ? "No payments in the period"
              : `${successRate.toFixed(1)}% completed`
          }
          icon={CreditCard}
          tone="success"
          loading={loading}
        />
        <StatCard
          label="Payment failure rate"
          value={loading ? "—" : failureRate === null ? "—" : `${failureRate.toFixed(1)}%`}
          hint={`${number.format(failedCount)} failed of ${number.format(paymentTotal)} payments`}
          icon={CreditCard}
          tone="danger"
          loading={loading}
        />
        <StatCard
          label={`Reversals · ${days}d`}
          value={loading ? "—" : number.format(data?.reversals?.count ?? 0)}
          hint="Transaction reversals recorded in the period"
          icon={Undo2}
          tone="warning"
          loading={loading}
        />
      </div>

      {loading ? (
        <div className="card flex items-center justify-center gap-2 px-5 py-20 text-[13px] font-semibold text-ink-500">
          <Spinner size={16} className="text-brand-600" /> Building reports…
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <TrendChart
              title="Transactions per day"
              description="Count of ledger transactions created each day"
              data={transactionsByDay}
              formatValue={(value) => number.format(value)}
            />
            <TrendChart
              title="Completed payments per day"
              description="Payments reaching COMPLETED status each day"
              data={completedByDay}
              formatValue={(value) => number.format(value)}
            />
          </div>

          {scope === "admin" ? (
            <TrendChart
              title="New accounts per day"
              description="Customer profiles created each day"
              data={(data?.registrations ?? []).map((point) => ({
                label: shortDate(point.date),
                value: point.count,
              }))}
              formatValue={(value) => number.format(value)}
            />
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <DistributionList
              title="Transaction types"
              description="Share of posted ledger activity by type"
              items={statusItems(data?.transactionTypes)}
            />
            <DistributionList
              title="Transaction status"
              description="Current status of transactions created in the period"
              items={statusItems(data?.transactionStatus)}
            />
            <DistributionList
              title="Payment status"
              description="Final state of payments created in the period"
              items={statusItems(paymentStatuses)}
            />
            <div className="card p-5">
              <h2 className="text-[15px] font-extrabold text-midnight">Amounts by outcome</h2>
              <p className="mt-0.5 text-[12px] text-muted">
                Payment principal per status, aggregated across currencies by the server.
              </p>
              {(data?.paymentAmounts ?? []).length === 0 ? (
                <p className="py-8 text-center text-[13px] text-muted">
                  No payments in this period.
                </p>
              ) : (
                <dl className="mt-4 space-y-2.5">
                  {data.paymentAmounts.map((row) => (
                    <div
                      key={row.value}
                      className="flex items-center justify-between gap-3 border-b border-ink-100 pb-2 text-[12.5px] last:border-0 last:pb-0"
                    >
                      <dt className="font-semibold text-body">{titleCase(row.value)}</dt>
                      <dd className="num font-bold text-midnight">{row.amount}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <p className="mt-3 text-[11px] text-muted">
                Amounts are shown as decimal totals without a currency symbol because more than
                one currency can contribute.
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card overflow-hidden">
              <div className="border-b border-ink-100 px-5 py-4">
                <h2 className="text-[15px] font-extrabold text-midnight">Volume by currency</h2>
                <p className="mt-0.5 text-[12px] text-muted">
                  Principal and fees for transactions created in the period.
                </p>
              </div>
              {(data?.volumeByCurrency ?? []).length === 0 ? (
                <p className="px-5 py-10 text-center text-[13px] text-muted">
                  No transactions in this period.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Currency</th>
                        <th>Count</th>
                        <th>Volume</th>
                        <th>Fees</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.volumeByCurrency.map((row) => (
                        <tr key={row.currency}>
                          <td className="font-semibold text-midnight">{row.currency}</td>
                          <td className="num text-[12.5px]">{number.format(row.count)}</td>
                          <td className="num text-[12.5px]">
                            {formatCurrency(row.amount, row.currency)}
                          </td>
                          <td className="num text-[12.5px] text-muted">
                            {formatCurrency(row.fees, row.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="card overflow-hidden">
              <div className="border-b border-ink-100 px-5 py-4">
                <h2 className="text-[15px] font-extrabold text-midnight">
                  Withdrawals and reversals
                </h2>
                <p className="mt-0.5 text-[12px] text-muted">
                  Withdrawal requests by status and reversal amounts by currency.
                </p>
              </div>
              <div className="divide-y divide-ink-100">
                {(data?.withdrawals?.byStatus ?? []).map((row) => (
                  <div
                    key={`${row.value}-${row.currency}`}
                    className="flex items-center justify-between gap-3 px-5 py-2.5 text-[12.5px]"
                  >
                    <span className="font-semibold text-body">
                      Withdrawals · {titleCase(row.value)}
                    </span>
                    <span className="num text-muted">
                      {row.count} · {formatCurrency(row.amount, row.currency)}
                    </span>
                  </div>
                ))}
                {(data?.reversals?.byCurrency ?? []).map((row) => (
                  <div
                    key={`reversal-${row.currency}`}
                    className="flex items-center justify-between gap-3 px-5 py-2.5 text-[12.5px]"
                  >
                    <span className="font-semibold text-body">
                      Reversed amount · {row.currency}
                    </span>
                    <span className="num text-muted">
                      {row.count} · {formatCurrency(row.amount, row.currency)}
                    </span>
                  </div>
                ))}
                {(data?.withdrawals?.byStatus ?? []).length === 0 &&
                (data?.reversals?.byCurrency ?? []).length === 0 ? (
                  <p className="px-5 py-10 text-center text-[13px] text-muted">
                    No withdrawals or reversals in this period.
                  </p>
                ) : null}
              </div>
            </section>
          </div>
        </>
      )}

      <p className="flex items-center gap-2 text-[12px] text-muted">
        <Banknote size={14} /> Figures reflect persisted ledger and payment records only. Rates
        use the number of payments created in the period as the denominator.
      </p>
    </div>
  );
}
