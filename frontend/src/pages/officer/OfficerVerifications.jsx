import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { FileSearch, Search } from "lucide-react";
import { getOfficerReviews } from "../../services/kycService";
import { normalizeApiError } from "../../utils/apiError";
import { formatDate, formatDateTime, titleCase } from "../../utils/format";
import { documentTypeLabel } from "../../utils/kyc";
import PageHeader from "../../components/ui/PageHeader";
import Alert from "../../components/ui/Alert";
import EmptyState from "../../components/ui/EmptyState";
import StatusBadge from "../../components/ui/StatusBadge";
import { Spinner } from "../../components/ui/Spinner";

const STATUS_OPTIONS = [
  ["PENDING_REVIEW", "Pending review"],
  ["ALL", "All statuses"],
  ["IN_PROGRESS", "In progress"],
  ["NEEDS_RESUBMISSION", "Needs resubmission"],
  ["DRAFT", "Draft"],
  ["APPROVED", "Approved"],
  ["REJECTED", "Rejected"],
];

const emptyFilters = { status: "PENDING_REVIEW", q: "", from: "", to: "", sort: "" };

const toIso = (value) => (value ? new Date(value).toISOString() : undefined);

const buildParams = (filters, cursor) => ({
  status: filters.status,
  limit: 25,
  ...(cursor ? { cursor } : {}),
  ...(filters.q.trim().length >= 3 ? { q: filters.q.trim() } : {}),
  ...(filters.sort ? { sort: filters.sort } : {}),
  ...(filters.from ? { from: toIso(filters.from) } : {}),
  ...(filters.to ? { to: toIso(filters.to) } : {}),
});

export default function OfficerVerifications() {
  const [searchParams] = useSearchParams();
  const initial = { ...emptyFilters, q: searchParams.get("q") || "" };
  const [filters, setFilters] = useState(initial);
  const [applied, setApplied] = useState(initial);
  const [submissions, setSubmissions] = useState([]);
  const [page, setPage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await getOfficerReviews(buildParams(applied));
        if (!active) return;
        setSubmissions(data.submissions);
        setPage(data.page);
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
  }, [applied]);

  const applyFilters = (event) => {
    event.preventDefault();
    setLoading(true);
    setApplied({ ...filters });
  };

  const resetFilters = () => {
    setFilters(emptyFilters);
    setLoading(true);
    setApplied(emptyFilters);
  };

  const loadMore = async () => {
    if (!page?.nextCursor) return;
    setLoadingMore(true);
    try {
      const data = await getOfficerReviews(buildParams(applied, page.nextCursor));
      setSubmissions((current) => [...current, ...data.submissions]);
      setPage(data.page);
    } catch (requestError) {
      setError(normalizeApiError(requestError).message);
    } finally {
      setLoadingMore(false);
    }
  };

  const queueLabel =
    applied.status === "PENDING_REVIEW"
      ? "Submissions awaiting a decision are ordered oldest first."
      : "Submissions in this view are ordered by most recent activity.";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Verification officer"
        title="Verification queue"
        description="Search and filter identity submissions. The queue exposes a customer reference and document metadata only; personal names and document images are available inside a review, under access logging."
      />

      <form onSubmit={applyFilters} className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
        <label className="lg:col-span-1">
          <span className="field-label">Status</span>
          <select
            value={filters.status}
            onChange={(event) =>
              setFilters((current) => ({ ...current, status: event.target.value }))
            }
            className="field-input"
          >
            {STATUS_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="lg:col-span-2">
          <span className="field-label">Search</span>
          <div className="relative">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
            />
            <input
              type="search"
              value={filters.q}
              onChange={(event) =>
                setFilters((current) => ({ ...current, q: event.target.value }))
              }
              placeholder="Submission or customer reference (3+ characters)"
              className="field-input !pl-9"
            />
          </div>
        </label>
        <label>
          <span className="field-label">From</span>
          <input
            type="datetime-local"
            value={filters.from}
            onChange={(event) =>
              setFilters((current) => ({ ...current, from: event.target.value }))
            }
            className="field-input"
          />
        </label>
        <label>
          <span className="field-label">To</span>
          <input
            type="datetime-local"
            value={filters.to}
            onChange={(event) =>
              setFilters((current) => ({ ...current, to: event.target.value }))
            }
            className="field-input"
          />
        </label>
        <label>
          <span className="field-label">Order</span>
          <select
            value={filters.sort}
            onChange={(event) =>
              setFilters((current) => ({ ...current, sort: event.target.value }))
            }
            className="field-input"
          >
            <option value="">Default</option>
            <option value="oldest">Oldest first</option>
            <option value="newest">Newest first</option>
          </select>
        </label>
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-6">
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? <Spinner size={15} /> : <Search size={15} />} Apply
          </button>
          <button type="button" className="btn-ghost" onClick={resetFilters} disabled={loading}>
            Reset
          </button>
        </div>
      </form>

      <Alert tone="info">{queueLabel}</Alert>
      {error ? <Alert tone="error">{error}</Alert> : null}

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-5 py-4">
          <div>
            <h2 className="text-[15px] font-extrabold text-midnight">Submissions</h2>
            <p className="mt-0.5 text-[12px] text-muted">
              {page
                ? `${page.total} submission${page.total === 1 ? "" : "s"} match this view`
                : "Loading submissions"}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 px-5 py-16 text-[13px] font-semibold text-ink-500">
            <Spinner size={16} className="text-brand-600" /> Loading queue…
          </div>
        ) : submissions.length === 0 ? (
          <EmptyState
            icon={FileSearch}
            title="No submissions in this view"
            description="Adjust the status, search term or date range to widen the results."
            className="border-0 shadow-none"
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Submission</th>
                    <th>Customer ref.</th>
                    <th>Document</th>
                    <th>Submitted</th>
                    <th>Status</th>
                    <th>Reviewer</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {submissions.map((submission) => {
                    const latestReview = submission.reviews?.[0];
                    const reviewable = submission.status === "PENDING_REVIEW";
                    return (
                      <tr key={submission.id}>
                        <td>
                          <p className="max-w-[13rem] truncate font-mono text-[12px] font-semibold text-midnight">
                            {submission.id}
                          </p>
                          <p className="text-[11px] text-muted">
                            {submission._count?.documents ?? 0} document
                            {(submission._count?.documents ?? 0) === 1 ? "" : "s"}
                          </p>
                        </td>
                        <td>
                          <span className="block max-w-[10rem] truncate font-mono text-[11.5px] text-body">
                            {submission.userId}
                          </span>
                        </td>
                        <td className="text-[12.5px]">
                          {submission.documentType
                            ? documentTypeLabel(submission.documentType)
                            : "—"}
                        </td>
                        <td className="whitespace-nowrap text-[12px] text-muted">
                          {submission.submittedAt
                            ? formatDate(submission.submittedAt)
                            : formatDateTime(submission.updatedAt)}
                        </td>
                        <td>
                          <StatusBadge value={submission.status} />
                        </td>
                        <td>
                          {latestReview ? (
                            <>
                              <p className="text-[11.5px] font-semibold text-body">
                                {titleCase(latestReview.decision)}
                              </p>
                              <p className="max-w-[9rem] truncate font-mono text-[10.5px] text-muted">
                                {latestReview.reviewerId}
                              </p>
                            </>
                          ) : (
                            <span className="text-[12px] text-muted">Unassigned</span>
                          )}
                        </td>
                        <td className="text-right">
                          <Link
                            to={`/officer/verifications/${submission.id}`}
                            className="link text-[12px]"
                          >
                            {reviewable ? "Review" : "View"}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-ink-100 md:hidden">
              {submissions.map((submission) => (
                <li key={submission.id} className="px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[12px] font-semibold text-midnight">
                        {submission.id}
                      </p>
                      <p className="mt-0.5 truncate text-[11.5px] text-muted">
                        Customer {submission.userId}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <StatusBadge value={submission.status} />
                        <span className="text-[11px] text-muted">
                          {submission.submittedAt
                            ? `Submitted ${formatDate(submission.submittedAt)}`
                            : `Updated ${formatDateTime(submission.updatedAt)}`}
                        </span>
                      </div>
                    </div>
                    <Link
                      to={`/officer/verifications/${submission.id}`}
                      className="link shrink-0 text-[12px]"
                    >
                      {submission.status === "PENDING_REVIEW" ? "Review" : "View"}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>

            {page?.hasMore ? (
              <div className="border-t border-ink-100 px-4 py-3 text-center">
                <button
                  type="button"
                  className="btn-ghost !py-2 !text-[13px]"
                  onClick={loadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? <Spinner size={14} /> : null} Load more
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
