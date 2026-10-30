import { useEffect, useState } from "react";
import { ClipboardList, Lock, Search } from "lucide-react";
import { listAuditLogs } from "../../services/staffService";
import { normalizeApiError } from "../../utils/apiError";
import { formatDateTime, titleCase } from "../../utils/format";
import PageHeader from "../../components/ui/PageHeader";
import Alert from "../../components/ui/Alert";
import EmptyState from "../../components/ui/EmptyState";
import StatusBadge from "../../components/ui/StatusBadge";
import OffsetPagination from "../../components/staff/OffsetPagination";
import { Spinner } from "../../components/ui/Spinner";

const SOURCE_OPTIONS = [
  ["", "All record types"],
  ["FINANCIAL_POLICY", "Financial policy revisions"],
  ["TRANSACTION_REVERSAL", "Transaction reversals"],
  ["PAYMENT_RECONCILIATION", "Payment reconciliations"],
];

const SOURCE_LABELS = {
  FINANCIAL_POLICY: "Policy revision",
  TRANSACTION_REVERSAL: "Reversal",
  PAYMENT_RECONCILIATION: "Reconciliation",
};

const emptyFilters = { source: "", actorId: "", from: "", to: "" };

const toIso = (value) => (value ? new Date(value).toISOString() : undefined);

export default function AdminAuditLogs() {
  const [filters, setFilters] = useState(emptyFilters);
  const [applied, setApplied] = useState(emptyFilters);
  const [logs, setLogs] = useState([]);
  const [pageInfo, setPageInfo] = useState(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchPage = async (nextFilters, nextPage) => {
    try {
      const data = await listAuditLogs({
        page: nextPage,
        limit: 25,
        ...(nextFilters.source ? { source: nextFilters.source } : {}),
        ...(nextFilters.actorId ? { actorId: nextFilters.actorId.trim() } : {}),
        ...(nextFilters.from ? { from: toIso(nextFilters.from) } : {}),
        ...(nextFilters.to ? { to: toIso(nextFilters.to) } : {}),
      });
      setLogs(data.logs);
      setPageInfo(data.page);
      setTruncated(data.truncated);
      setError("");
    } catch (requestError) {
      setError(normalizeApiError(requestError).message);
      setLogs([]);
      setPageInfo(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await listAuditLogs({ page: 1, limit: 25 });
        if (!active) return;
        setLogs(data.logs);
        setPageInfo(data.page);
        setTruncated(data.truncated);
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
  }, []);

  const applyFilters = (event) => {
    event.preventDefault();
    setLoading(true);
    setApplied(filters);
    fetchPage(filters, 1);
  };

  const resetFilters = () => {
    setFilters(emptyFilters);
    setApplied(emptyFilters);
    setLoading(true);
    fetchPage(emptyFilters, 1);
  };

  const changePage = (nextPage) => {
    setLoading(true);
    fetchPage(applied, nextPage);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Audit records"
        description="Read-only record of the financial governance events the platform persists: financial policy revisions, transaction reversals and payment reconciliation outcomes."
      />

      <Alert tone="info">
        <span className="inline-flex items-center gap-1.5 font-bold">
          <Lock size={13} /> Read-only
        </span>{" "}
        These records cannot be edited or deleted from this interface. Results are merged from
        the most recent 500 records per source and then filtered, so an empty result may mean the
        filter excluded the only records in that range.
      </Alert>

      {truncated ? (
        <Alert tone="warning">
          One or more sources reached the 500-record read limit. Narrow the date range or filter
          by record type for complete results in that window.
        </Alert>
      ) : null}

      <form onSubmit={applyFilters} className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <label>
          <span className="field-label">Record type</span>
          <select
            value={filters.source}
            onChange={(event) =>
              setFilters((current) => ({ ...current, source: event.target.value }))
            }
            className="field-input"
          >
            {SOURCE_OPTIONS.map(([value, label]) => (
              <option key={value || "all"} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">Actor ID</span>
          <input
            type="text"
            value={filters.actorId}
            onChange={(event) =>
              setFilters((current) => ({ ...current, actorId: event.target.value }))
            }
            placeholder="User ID or SYSTEM"
            className="field-input"
          />
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
        <div className="flex items-end gap-2">
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? <Spinner size={15} /> : <Search size={15} />} Apply
          </button>
          <button type="button" className="btn-ghost" onClick={resetFilters} disabled={loading}>
            Reset
          </button>
        </div>
      </form>

      {error ? <Alert tone="error">{error}</Alert> : null}

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-5 py-4">
          <div>
            <h2 className="text-[15px] font-extrabold text-midnight">Governance events</h2>
            <p className="mt-0.5 text-[12px] text-muted">
              {pageInfo
                ? `${pageInfo.total} record${pageInfo.total === 1 ? "" : "s"} in the current view`
                : "Loading records"}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 px-5 py-16 text-[13px] font-semibold text-ink-500">
            <Spinner size={16} className="text-brand-600" /> Loading audit records…
          </div>
        ) : logs.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No audit records in this view"
            description="Financial policy changes, reversals and payment reconciliations appear here as they happen."
            className="border-0 shadow-none"
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Target</th>
                    <th>Outcome</th>
                    <th>Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id}>
                      <td className="whitespace-nowrap text-[12px] text-muted">
                        {formatDateTime(log.timestamp)}
                      </td>
                      <td>
                        <p className="font-semibold text-midnight">
                          {log.actorId === "SYSTEM" ? "System" : "User"}
                        </p>
                        <p className="max-w-[10rem] truncate font-mono text-[11px] text-muted">
                          {log.actorId}
                        </p>
                      </td>
                      <td>
                        <p className="text-[12.5px] font-semibold text-midnight">
                          {titleCase(log.action)}
                        </p>
                        <p className="text-[11px] text-muted">
                          {SOURCE_LABELS[log.source] || titleCase(log.source)}
                        </p>
                      </td>
                      <td>
                        <p className="max-w-[14rem] truncate text-[12.5px] text-body">
                          {log.target}
                        </p>
                        {log.detail ? (
                          <p className="max-w-[18rem] truncate text-[11px] text-muted">
                            {log.detail}
                          </p>
                        ) : null}
                      </td>
                      <td>
                        <StatusBadge value={log.outcome} />
                      </td>
                      <td>
                        <span className="block max-w-[9rem] truncate font-mono text-[11px] text-muted">
                          {log.reference}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pageInfo ? (
              <OffsetPagination
                page={pageInfo.page}
                totalPages={pageInfo.totalPages}
                onChange={changePage}
                busy={loading}
              />
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
