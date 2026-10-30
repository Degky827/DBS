import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeftRight,
  ArrowRight,
  CreditCard,
  ShieldCheck,
  UserRound,
  Users,
  WalletCards,
} from "lucide-react";
import {
  getAdminAnalytics,
  getAdminOverview,
  listPlatformTransactions,
} from "../../services/staffService";
import { getOfficerReviewStats } from "../../services/kycService";
import { normalizeApiError } from "../../utils/apiError";
import { formatCurrency, formatDateTime, titleCase } from "../../utils/format";
import PageHeader from "../../components/ui/PageHeader";
import Alert from "../../components/ui/Alert";
import StatusBadge from "../../components/ui/StatusBadge";
import EmptyState from "../../components/ui/EmptyState";
import { Spinner } from "../../components/ui/Spinner";
import StatCard from "../../components/staff/StatCard";
import TrendChart from "../../components/staff/TrendChart";
import DistributionList from "../../components/staff/DistributionList";
import PeriodSelect from "../../components/staff/PeriodSelect";

const TONES = {
  POSTED: "success",
  PARTIALLY_REVERSED: "warning",
  REVERSED: "neutral",
  COMPLETED: "success",
  PENDING: "warning",
  FAILED: "danger",
};

const statusItems = (rows = []) =>
  rows
    .filter((row) => row.count > 0)
    .map((row) => ({
      label: titleCase(row.value),
      value: row.count,
      tone: TONES[row.value] || "brand",
    }));

export default function AdminDashboard() {
  const [days, setDays] = useState(30);
  const [state, setState] = useState({
    loading: true,
    error: "",
    overview: null,
    analytics: null,
    recent: [],
    kyc: null,
    kycError: "",
  });

  useEffect(() => {
    let active = true;
    (async () => {
      const [overview, analytics, recent, kyc] = await Promise.allSettled([
        getAdminOverview({ days }),
        getAdminAnalytics({ days }),
        listPlatformTransactions({ limit: 8 }),
        getOfficerReviewStats(),
      ]);
      if (!active) return;

      const failure = [overview, analytics, recent].find(
        (result) => result.status === "rejected"
      );
      setState({
        loading: false,
        error: failure
          ? normalizeApiError(failure.reason).message
          : "",
        overview: overview.status === "fulfilled" ? overview.value : null,
        analytics: analytics.status === "fulfilled" ? analytics.value : null,
        recent: recent.status === "fulfilled" ? recent.value.transactions : [],
        kyc: kyc.status === "fulfilled" ? kyc.value : null,
        kycError:
          kyc.status === "rejected"
            ? normalizeApiError(kyc.reason).message
            : "",
      });
    })();
    return () => {
      active = false;
    };
  }, [days]);

  const changePeriod = (value) => {
    setDays(value);
    setState((current) => ({ ...current, loading: true, error: "" }));
  };

  const { loading, error, overview, analytics, recent, kyc, kycError } = state;

  const transactionTrend =
    analytics?.transactionsByDay?.map((point) => ({
      label: point.date.slice(5),
      value: point.count,
    })) ?? [];
  const registrationTrend =
    analytics?.registrations?.map((point) => ({
      label: point.date.slice(5),
      value: point.count,
    })) ?? [];
  const paymentTrend =
    analytics?.paymentsByDay?.map((point) => ({
      label: point.date.slice(5),
      value: point.completed,
    })) ?? [];

  const pendingReview = kyc?.byStatus?.PENDING_REVIEW ?? 0;
  const needsResubmission = kyc?.byStatus?.NEEDS_RESUBMISSION ?? 0;
  const paymentCounts = Object.fromEntries(
    (overview?.payments?.byStatus ?? []).map((row) => [row.value, row.count])
  );
  const volumeText = (overview?.transactions?.byCurrency ?? [])
    .map((row) => formatCurrency(row.amount, row.currency))
    .join(" · ");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Platform overview"
        description="Account, verification and financial activity across Meridian. Period-based metrics cover the selected reporting window."
        actions={<PeriodSelect value={days} onChange={changePeriod} />}
      />

      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Registered users"
          value={overview?.users?.total ?? "—"}
          hint={`${overview?.users?.newInPeriod ?? 0} registered in the last ${days} days`}
          icon={Users}
          tone="brand"
          loading={loading}
        />
        <StatCard
          label="Active wallets"
          value={overview?.wallets?.active ?? "—"}
          hint={`${overview?.wallets?.total ?? 0} wallets provisioned`}
          icon={WalletCards}
          tone="navy"
          loading={loading}
        />
        <StatCard
          label="Pending verifications"
          value={kyc ? pendingReview : "—"}
          hint={
            kycError
              ? "Verification service unavailable"
              : `${needsResubmission} awaiting resubmission`
          }
          icon={ShieldCheck}
          tone="warning"
          loading={loading}
        />
        <StatCard
          label={`Transactions (${days}d)`}
          value={overview?.transactions?.inPeriod ?? "—"}
          hint={volumeText ? `Volume ${volumeText}` : "No transaction volume"}
          icon={ArrowLeftRight}
          tone="success"
          loading={loading}
        />
        <StatCard
          label="Payments completed"
          value={overview ? paymentCounts.COMPLETED ?? 0 : "—"}
          hint={`${paymentCounts.PENDING ?? 0} pending · ${paymentCounts.FAILED ?? 0} failed`}
          icon={CreditCard}
          tone="success"
          loading={loading}
        />
        <StatCard
          label="Reversals (period)"
          value={overview?.reversals?.inPeriod ?? "—"}
          hint={`${overview?.withdrawals?.pending ?? 0} withdrawals pending`}
          icon={ArrowRight}
          tone="warning"
          loading={loading}
        />
        <StatCard
          label="Active policies"
          value={overview?.policies?.active ?? "—"}
          hint="Transfer, deposit and withdrawal rules in force"
          icon={UserRound}
          tone="neutral"
          loading={loading}
        />
        <StatCard
          label="Review decisions (30d)"
          value={kyc ? (kyc.reviewsLast30Days?.approve ?? 0) + (kyc.reviewsLast30Days?.reject ?? 0) : "—"}
          hint={
            kyc
              ? `${kyc.reviewsLast30Days?.approve ?? 0} approved · ${kyc.reviewsLast30Days?.reject ?? 0} rejected`
              : "Verification statistics unavailable"
          }
          icon={ShieldCheck}
          tone="brand"
          loading={loading}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <TrendChart
          title="Transaction volume"
          description={`Transaction count per day · last ${days} days`}
          data={transactionTrend}
          formatValue={(value) => `${value}`}
        />
        <TrendChart
          title="New registrations"
          description={`Accounts created per day · last ${days} days`}
          data={registrationTrend}
          formatValue={(value) => `${value}`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <DistributionList
          title="Transaction status"
          description={`Last ${days} days`}
          items={statusItems(analytics?.transactionStatus)}
        />
        <DistributionList
          title="Payment status"
          description={`Last ${days} days`}
          items={statusItems(analytics?.paymentStatus)}
        />
        <DistributionList
          title="Transaction types"
          description={`Last ${days} days`}
          items={(analytics?.transactionTypes ?? [])
            .filter((row) => row.count > 0)
            .map((row) => ({
              label: titleCase(row.value),
              value: row.count,
              tone: row.value === "DEPOSIT" ? "brand" : "neutral",
            }))}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
            <div>
              <h2 className="text-[15px] font-extrabold text-midnight">
                Recent platform activity
              </h2>
              <p className="mt-0.5 text-[12px] text-muted">
                Latest transactions across all customers.
              </p>
            </div>
            <Link to="/finance/transactions" className="link text-[12px]">
              Monitor all
            </Link>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 px-5 py-14 text-[13px] font-semibold text-ink-500">
              <Spinner size={16} className="text-brand-600" /> Loading activity…
            </div>
          ) : recent.length === 0 ? (
            <EmptyState
              icon={ArrowLeftRight}
              title="No transactions yet"
              description="Platform transactions appear here once customers start moving money."
              className="border-0 shadow-none"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Customer</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Recorded</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((transaction) => (
                    <tr key={transaction.id}>
                      <td>
                        <Link
                          to={`/finance/transactions/${transaction.reference}`}
                          className="font-mono text-[12px] font-semibold text-brand-700 hover:underline"
                        >
                          {transaction.reference}
                        </Link>
                      </td>
                      <td className="text-[12.5px]">
                        {transaction.initiatedBy?.email || "—"}
                      </td>
                      <td className="num whitespace-nowrap text-[12.5px] font-semibold">
                        {formatCurrency(transaction.amount, transaction.currency)}
                      </td>
                      <td>
                        <StatusBadge value={transaction.status} />
                      </td>
                      <td className="whitespace-nowrap text-[12px] text-muted">
                        {formatDateTime(transaction.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card p-5">
          <h2 className="text-[15px] font-extrabold text-midnight">
            Administrative actions
          </h2>
          <p className="mt-0.5 text-[12px] text-muted">
            Common tasks across platform operations.
          </p>
          <div className="mt-4 space-y-2">
            {[
              { to: "/admin/users", label: "Review customer accounts" },
              { to: "/officer/verifications", label: "Open verification queue" },
              { to: "/admin/policies", label: "Inspect financial policies" },
              { to: "/admin/audit-logs", label: "Read audit records" },
              { to: "/admin/reports", label: "View platform reports" },
            ].map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="flex items-center justify-between rounded-lg border border-ink-100 px-3.5 py-2.5 text-[13px] font-semibold text-body transition hover:border-brand-600/30 hover:bg-brand-50"
              >
                {item.label}
                <ArrowRight size={15} className="text-muted" />
              </Link>
            ))}
          </div>
        </section>
      </div>

      {paymentTrend.length > 0 ? (
        <TrendChart
          title="Completed deposits"
          description={`Completed provider payments per day · last ${days} days`}
          data={paymentTrend}
          formatValue={(value) => `${value}`}
        />
      ) : null}
    </div>
  );
}
