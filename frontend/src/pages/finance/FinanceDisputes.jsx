import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Gavel, Search } from "lucide-react";
import PageHeader from "../../components/ui/PageHeader";
import Alert from "../../components/ui/Alert";
import EmptyState from "../../components/ui/EmptyState";
import StatusBadge from "../../components/ui/StatusBadge";
import { Skeleton } from "../../components/ui/Spinner";
import { listAllDisputes } from "../../services/disputesService";
import { normalizeApiError } from "../../utils/apiError";
import { formatCurrency, formatDateTime, titleCase } from "../../utils/format";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "OPEN", label: "Open" },
  { value: "UNDER_REVIEW", label: "Under review" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "REJECTED", label: "Rejected" },
];

const customerName = (customer) => customer?.name || customer?.email || "—";

export default function FinanceDisputes() {
  const [disputes, setDisputes] = useState([]);
  const [page, setPage] = useState(null);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const data = await listAllDisputes({
          status: status || undefined,
          q: appliedQuery || undefined,
        });
        if (!active) return;
        setDisputes(data.disputes || []);
        setPage(data.page || null);
        setError("");
      } catch (requestError) {
        if (active) setError(normalizeApiError(requestError).message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [status, appliedQuery]);

  const search = (event) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed && trimmed.length < 3) {
      setError("Search needs at least 3 characters of a dispute or transaction reference.");
      return;
    }
    setError("");
    setAppliedQuery(trimmed);
  };

  const loadMore = async () => {
    if (!page?.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await listAllDisputes({
        status: status || undefined,
        q: appliedQuery || undefined,
        cursor: page.nextCursor,
      });
      setDisputes((current) => [...current, ...(data.disputes || [])]);
      setPage(data.page || null);
    } catch (requestError) {
      setError(normalizeApiError(requestError).message);
    } finally {
      setLoadingMore(false);
    }
  };

  const openCount = disputes.filter((d) => d.status === "OPEN").length;
  const reviewCount = disputes.filter((d) => d.status === "UNDER_REVIEW").length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finance"
        title="Dispute queue"
        description="Every customer claim against a posted transaction. Open a case to read the customer statement, assign it, and record a decision — the customer is notified automatically."
      />

      <div className="card grid gap-4 p-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
        <form onSubmit={search} className="flex flex-wrap items-end gap-3">
          <label className="min-w-[220px] flex-1 space-y-1 text-xs font-bold text-ink-500">
            Reference search
            <div className="relative">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
              />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Dispute or transaction reference"
                className="field-input pl-9"
              />
            </div>
          </label>
          <label className="space-y-1 text-xs font-bold text-ink-500">
            Status
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="field-input"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={loading} className="btn-primary">
            <Search size={15} /> Search
          </button>
        </form>
        <div className="flex items-center justify-start gap-6 border-ink-100 lg:border-l lg:pl-6">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">Open</p>
            <p className="num text-2xl font-extrabold text-warning">{openCount}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
              Under review
            </p>
            <p className="num text-2xl font-extrabold text-midnight">{reviewCount}</p>
          </div>
        </div>
      </div>

      {error ? (
        <Alert tone="error" dismissible onDismiss={() => setError("")}>
          {error}
        </Alert>
      ) : null}

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : disputes.length === 0 ? (
        <EmptyState
          icon={Gavel}
          title="No disputes match"
          description="Adjust the status filter or clear the reference search to see other cases."
          actionLabel={status || appliedQuery ? "Reset filters" : undefined}
          onAction={
            status || appliedQuery
              ? () => {
                  setStatus("");
                  setAppliedQuery("");
                  setQuery("");
                }
              : undefined
          }
        />
      ) : (
        <ul className="space-y-3">
          {disputes.map((dispute) => (
            <li key={dispute.id}>
              <Link
                to={`/finance/disputes/${dispute.reference}`}
                className="card flex flex-wrap items-center gap-4 p-5 transition hover:border-brand-600/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[14px] font-extrabold text-midnight">
                      {titleCase(dispute.reason)}
                    </p>
                    <StatusBadge value={dispute.status} />
                    {dispute.assignedTo ? (
                      <span className="badge-neutral">Assigned · {dispute.assignedTo}</span>
                    ) : null}
                  </div>
                  <p className="mt-1 truncate text-[12.5px] text-body">
                    {customerName(dispute.customer)}
                  </p>
                  <p className="mt-0.5 text-[11.5px] text-muted">
                    <span className="font-mono">{dispute.reference.slice(0, 8)}</span> · opened{" "}
                    {formatDateTime(dispute.openedAt)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="num text-[14px] font-extrabold text-midnight">
                    {dispute.transaction
                      ? formatCurrency(dispute.transaction.amount, dispute.transaction.currency)
                      : "—"}
                  </p>
                  <p className="text-[11.5px] text-muted">
                    {dispute.transaction ? titleCase(dispute.transaction.type) : ""}
                  </p>
                </div>
                <ChevronRight size={16} className="shrink-0 text-ink-400" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {page?.hasMore ? (
        <div className="flex justify-center">
          <button type="button" onClick={loadMore} disabled={loadingMore} className="btn-ghost">
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
