import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileSearch,
  RotateCcw,
  ShieldX,
  Users,
} from "lucide-react";
import { getOfficerReviewStats, getOfficerReviews } from "../../services/kycService";
import { normalizeApiError } from "../../utils/apiError";
import { formatDateTime, titleCase } from "../../utils/format";
import PageHeader from "../../components/ui/PageHeader";
import Alert from "../../components/ui/Alert";
import StatCard from "../../components/staff/StatCard";
import { Spinner } from "../../components/ui/Spinner";

const waitLabel = (iso) => {
  if (!iso) return "No submissions waiting";
  const hours = Math.max(0, (Date.now() - new Date(iso).getTime()) / 36e5);
  if (hours < 1) return "Less than an hour";
  if (hours < 48) return `${Math.floor(hours)} hour${Math.floor(hours) === 1 ? "" : "s"}`;
  return `${Math.floor(hours / 24)} days`;
};

export default function OfficerDashboard() {
  const [stats, setStats] = useState(null);
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      const [statsResult, queueResult] = await Promise.allSettled([
        getOfficerReviewStats(),
        getOfficerReviews({ status: "PENDING_REVIEW", limit: 6, sort: "oldest" }),
      ]);
      if (!active) return;
      if (statsResult.status === "fulfilled") setStats(statsResult.value);
      if (queueResult.status === "fulfilled") setQueue(queueResult.value.submissions);
      const failure = [statsResult, queueResult].find((result) => result.status === "rejected");
      if (failure) setError(normalizeApiError(failure.reason).message);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const counts = stats?.byStatus ?? {};
  const oldest = stats?.oldestPendingAt;
  const decisions = stats?.reviewsLast30Days ?? {};

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Verification officer"
        title="Review operations"
        description="Submissions waiting on manual identity decisions. All counts come from the verification service; decisions are recorded server-side only."
        actions={
          <Link to="/officer/verifications" className="btn-primary">
            <FileSearch size={15} /> Open review queue
          </Link>
        }
      />

      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          label="Pending review"
          value={loading ? "—" : counts.PENDING_REVIEW ?? 0}
          hint={oldest ? `Oldest waiting ${waitLabel(oldest)}` : "Queue is clear"}
          icon={Clock3}
          tone="warning"
          loading={loading}
        />
        <StatCard
          label="In progress"
          value={loading ? "—" : counts.IN_PROGRESS ?? 0}
          hint="Provider session or document upload not complete"
          icon={Users}
          tone="brand"
          loading={loading}
        />
        <StatCard
          label="Needs resubmission"
          value={loading ? "—" : counts.NEEDS_RESUBMISSION ?? 0}
          hint="Customer action required before review"
          icon={RotateCcw}
          tone="warning"
          loading={loading}
        />
        <StatCard
          label="Approved"
          value={loading ? "—" : counts.APPROVED ?? 0}
          hint={`${decisions.approve ?? 0} approvals in the last 30 days`}
          icon={CheckCircle2}
          tone="success"
          loading={loading}
        />
        <StatCard
          label="Rejected"
          value={loading ? "—" : counts.REJECTED ?? 0}
          hint={`${decisions.reject ?? 0} rejections in the last 30 days`}
          icon={ShieldX}
          tone="danger"
          loading={loading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card overflow-hidden lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-5 py-4">
            <div>
              <h2 className="text-[15px] font-extrabold text-midnight">Oldest pending submissions</h2>
              <p className="mt-0.5 text-[12px] text-muted">
                Ordered by the time they entered review, oldest first.
              </p>
            </div>
            <Link to="/officer/verifications" className="link text-[12px]">
              View all
            </Link>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 px-5 py-14 text-[13px] font-semibold text-ink-500">
              <Spinner size={16} className="text-brand-600" /> Loading queue…
            </div>
          ) : queue.length === 0 ? (
            <div className="px-5 py-14 text-center">
              <p className="text-[13px] font-semibold text-midnight">No submissions waiting</p>
              <p className="mt-1 text-[12px] text-muted">
                New submissions appear here once the customer completes the secure checks.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-ink-100">
              {queue.map((submission) => (
                <li key={submission.id}>
                  <Link
                    to={`/officer/verifications/${submission.id}`}
                    className="flex flex-wrap items-center gap-3 px-5 py-3.5 transition hover:bg-ink-50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-[12px] font-semibold text-midnight">
                        {submission.id}
                      </p>
                      <p className="mt-0.5 truncate text-[11.5px] text-muted">
                        Customer {submission.userId} ·{" "}
                        {submission.documentType ? titleCase(submission.documentType) : "No document"} ·{" "}
                        {submission._count?.documents ?? 0} file
                        {(submission._count?.documents ?? 0) === 1 ? "" : "s"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[11.5px] font-semibold text-body">
                        Waiting {waitLabel(submission.updatedAt)}
                      </p>
                      <p className="text-[11px] text-muted">
                        Updated {formatDateTime(submission.updatedAt)}
                      </p>
                    </div>
                    <ArrowRight size={15} className="text-ink-400" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-5">
          <h2 className="text-[15px] font-extrabold text-midnight">Decision activity</h2>
          <p className="mt-0.5 text-[12px] text-muted">Recorded decisions in the last 30 days.</p>
          <dl className="mt-4 space-y-3">
            <div className="flex items-center justify-between rounded-lg bg-[#ecfdf3] px-3.5 py-3">
              <dt className="text-[12.5px] font-semibold text-body">Approvals</dt>
              <dd className="num text-[15px] font-extrabold text-success">
                {loading ? "—" : decisions.approve ?? 0}
              </dd>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-[#fef2f2] px-3.5 py-3">
              <dt className="text-[12.5px] font-semibold text-body">Rejections</dt>
              <dd className="num text-[15px] font-extrabold text-danger">
                {loading ? "—" : decisions.reject ?? 0}
              </dd>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-ink-50 px-3.5 py-3">
              <dt className="text-[12.5px] font-semibold text-body">Drafts</dt>
              <dd className="num text-[15px] font-extrabold text-midnight">
                {loading ? "—" : counts.DRAFT ?? 0}
              </dd>
            </div>
          </dl>
          {stats?.generatedAt ? (
            <p className="mt-4 text-[11px] text-muted">
              Snapshot generated {formatDateTime(stats.generatedAt)}.
            </p>
          ) : null}
          <p className="mt-3 text-[11px] text-muted">
            Queue order prioritises the oldest pending submission.
          </p>
        </section>
      </div>
    </div>
  );
}
