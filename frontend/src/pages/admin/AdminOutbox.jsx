import { useEffect, useState } from "react";
import { RotateCcw, ScrollText, Search } from "lucide-react";
import PageHeader from "../../components/ui/PageHeader";
import Alert from "../../components/ui/Alert";
import EmptyState from "../../components/ui/EmptyState";
import StatusBadge from "../../components/ui/StatusBadge";
import { Skeleton } from "../../components/ui/Spinner";
import { listOutboxEvents, replayOutboxEvent } from "../../services/staffService";
import { normalizeApiError } from "../../utils/apiError";
import { formatDateTime, titleCase } from "../../utils/format";

const STATUS_OPTIONS = [
  { value: "pending", label: "Awaiting delivery" },
  { value: "failed", label: "Failed attempts" },
  { value: "published", label: "Delivered" },
  { value: "all", label: "All events" },
];

const ago = (iso) => {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return "—";
  const minutes = Math.round(ms / 60000);
  if (Math.abs(minutes) < 60)
    return `${minutes > 0 ? "in " : ""}${Math.abs(minutes)} min${
      Math.abs(minutes) === 1 ? "" : "s"
    }${minutes > 0 ? "" : " ago"}`;
  const hours = Math.round(minutes / 60);
  return hours < 48
    ? `${hours} hr${hours === 1 ? "" : "s"} ${minutes > 0 ? "ahead" : "ago"}`
    : formatDateTime(iso);
};

export default function AdminOutbox() {
  const [events, setEvents] = useState([]);
  const [page, setPage] = useState(null);
  const [status, setStatus] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const data = await listOutboxEvents({ status, limit: 50 });
        if (!active) return;
        setEvents(data.events || []);
        setPage(data.page || null);
      } catch (requestError) {
        if (active) setError(normalizeApiError(requestError).message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [status]);

  const loadMore = async () => {
    if (!page?.nextCursor) return;
    setLoading(true);
    try {
      const data = await listOutboxEvents({ status, limit: 50, cursor: page.nextCursor });
      setEvents((current) => [...current, ...(data.events || [])]);
      setPage(data.page || null);
    } catch (requestError) {
      setError(normalizeApiError(requestError).message);
    } finally {
      setLoading(false);
    }
  };

  const replay = async (event) => {
    setBusyId(event.id);
    setNotice("");
    setError("");
    try {
      await replayOutboxEvent(event.id);
      setEvents((current) =>
        current.map((item) =>
          item.id === event.id ? { ...item, attempts: 0, publishedAt: null, lastError: null } : item
        )
      );
      setNotice(`Event ${event.eventId.slice(0, 8)} (${event.type}) queued for redelivery.`);
    } catch (requestError) {
      setError(normalizeApiError(requestError).message);
    } finally {
      setBusyId(null);
    }
  };

  const pending = events.filter((event) => !event.publishedAt).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Event outbox"
        description="Every business change writes an event row in the same transaction; the dispatcher delivers it to the notification service. Retry-exhausted events are dead-lettered here so nothing is silently lost."
        actions={
          <label className="flex items-center gap-2 text-[12px] font-bold text-muted">
            View
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="field-input !w-auto !py-1.5 text-[12.5px]"
              aria-label="Filter outbox events"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        }
      />

      {notice ? (
        <Alert tone="success" dismissible onDismiss={() => setNotice("")}>
          {notice}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="error" dismissible onDismiss={() => setError("")}>
          {error}
        </Alert>
      ) : null}

      {loading && events.length === 0 ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : events.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No events in this view"
          description="Outbox events appear as soon as a transfer, deposit, withdrawal, dispute or account change is recorded."
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-3">
            <h2 className="text-[14px] font-extrabold text-midnight">{titleCase(status)} events</h2>
            <span className="badge-neutral">{pending} undelivered in this page</span>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table min-w-[860px]">
              <thead>
                <tr>
                  <th scope="col">Event</th>
                  <th scope="col">Aggregate</th>
                  <th scope="col">Occurred</th>
                  <th scope="col" className="text-right">
                    Attempts
                  </th>
                  <th scope="col">Next retry</th>
                  <th scope="col" className="text-right">
                    Delivery
                  </th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>
                      <p className="text-[12.5px] font-bold text-midnight">{event.type}</p>
                      <p className="mt-0.5 font-mono text-[10.5px] text-muted">
                        {event.eventId.slice(0, 8)}
                      </p>
                      {event.lastError ? (
                        <p className="mt-1 max-w-[260px] truncate text-[11px] text-danger">
                          {event.lastError}
                        </p>
                      ) : null}
                    </td>
                    <td className="text-[12px] text-muted">
                      {event.aggregateType}
                      <span className="mt-0.5 block font-mono text-[10.5px] text-ink-400">
                        {String(event.aggregateId).slice(0, 8)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap text-[12px] text-body">
                      {formatDateTime(event.occurredAt)}
                    </td>
                    <td className="num text-right text-[12.5px] font-bold text-midnight">
                      {event.attempts}
                    </td>
                    <td className="whitespace-nowrap text-[12px] text-muted">
                      {event.publishedAt ? "—" : ago(event.nextAttemptAt)}
                    </td>
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <StatusBadge
                          value={
                            event.publishedAt
                              ? "PUBLISHED"
                              : event.attempts > 0
                                ? "FAILED"
                                : "PENDING"
                          }
                        />
                        {event.publishedAt ? null : (
                          <button
                            type="button"
                            onClick={() => replay(event)}
                            disabled={busyId === event.id}
                            className="btn-ghost !px-2.5 !py-1 text-[11.5px]"
                          >
                            <RotateCcw size={12} /> {busyId === event.id ? "…" : "Replay"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="flex items-center gap-2 border-t border-ink-100 px-5 py-3 text-[11.5px] text-muted">
            <ScrollText size={13} /> Replay re-queues an event without changing its ID, so the
            notification service still de-duplicates it.
          </p>
          {page?.hasMore ? (
            <div className="border-t border-ink-100 px-5 py-3">
              <button type="button" onClick={loadMore} disabled={loading} className="btn-ghost">
                {loading ? "Loading…" : "Load more"}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
