import { useEffect, useState } from "react";
import { CheckCheck, Inbox, RefreshCw } from "lucide-react";
import PageHeader from "../../components/ui/PageHeader";
import Alert from "../../components/ui/Alert";
import EmptyState from "../../components/ui/EmptyState";
import { Skeleton } from "../../components/ui/Spinner";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../../services/notificationService";
import { normalizeApiError } from "../../utils/apiError";
import { formatDateTime, titleCase } from "../../utils/format";

const PAGE_SIZE = 20;

const EVENT_ICONS = {
  "transfer.completed": "Transfer",
  "deposit.completed": "Deposit",
  "withdrawal.reserved": "Withdrawal",
  "withdrawal.cancelled": "Withdrawal cancelled",
  "account.status_changed": "Account",
  "dispute.opened": "Dispute",
  "dispute.updated": "Dispute",
  "scheduled_transfer.failed": "Scheduled transfer",
  "ledger.integrity_failed": "Ledger integrity",
};

export default function Notifications() {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const data = await listNotifications({
          limit: PAGE_SIZE,
          ...(unreadOnly ? { unreadOnly: true } : {}),
        });
        if (!active) return;
        setItems(data.notifications || []);
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
  }, [unreadOnly]);

  const loadMore = async () => {
    if (!page?.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await listNotifications({
        limit: PAGE_SIZE,
        cursor: page.nextCursor,
        ...(unreadOnly ? { unreadOnly: true } : {}),
      });
      setItems((current) => [...current, ...(data.notifications || [])]);
      setPage(data.page || null);
    } catch (requestError) {
      setError(normalizeApiError(requestError).message);
    } finally {
      setLoadingMore(false);
    }
  };

  const readOne = async (notification) => {
    if (notification.readAt) return;
    setBusy(true);
    try {
      await markNotificationRead(notification.id);
      setItems((current) =>
        current.map((item) =>
          item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item
        )
      );
    } catch (requestError) {
      setError(normalizeApiError(requestError).message);
    } finally {
      setBusy(false);
    }
  };

  const readAll = async () => {
    setBusy(true);
    setError("");
    try {
      await markAllNotificationsRead();
      setItems((current) =>
        current.map((item) => (item.readAt ? item : { ...item, readAt: new Date().toISOString() }))
      );
      if (unreadOnly) {
        setItems([]);
        setPage(null);
      }
    } catch (requestError) {
      setError(normalizeApiError(requestError).message);
    } finally {
      setBusy(false);
    }
  };

  const unreadCount = items.filter((item) => !item.readAt).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Account"
        title="Notifications"
        description="Money movement, verification and dispute events recorded against your account. Emails are sent for the same events when delivery is enabled."
        actions={
          <>
            <button
              type="button"
              onClick={() => setUnreadOnly((current) => !current)}
              className="btn-ghost"
              aria-pressed={unreadOnly}
            >
              {unreadOnly ? "Show all" : "Unread only"}
            </button>
            <button
              type="button"
              onClick={readAll}
              disabled={busy || unreadCount === 0}
              className="btn-brand-outline"
            >
              <CheckCheck size={15} /> Mark all read
            </button>
          </>
        }
      />

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
      ) : items.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={unreadOnly ? "Nothing unread" : "No notifications yet"}
          description={
            unreadOnly
              ? "You are all caught up. Switch back to all notifications to see your history."
              : "Transfers, deposits, dispute updates and account changes will appear here."
          }
          actionLabel={unreadOnly ? "Show all notifications" : undefined}
          onAction={unreadOnly ? () => setUnreadOnly(false) : undefined}
        />
      ) : (
        <ul className="space-y-3">
          {items.map((notification) => {
            const unread = !notification.readAt;
            return (
              <li key={notification.id}>
                <button
                  type="button"
                  onClick={() => readOne(notification)}
                  className={`card w-full p-5 text-left transition ${
                    unread ? "border-brand-600/40 bg-brand-50/40" : ""
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[14px] font-extrabold text-midnight">
                        {notification.title}
                      </p>
                      <p className="mt-1 text-[13px] leading-relaxed text-body">
                        {notification.body}
                      </p>
                    </div>
                    {unread ? (
                      <span className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-brand-600">
                        <span className="sr-only">Unread</span>
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
                    <span className="badge-neutral">
                      {EVENT_ICONS[notification.eventType] ||
                        titleCase(notification.eventType?.replace(/_/g, " ") || "")}
                    </span>
                    {formatDateTime(notification.createdAt)}
                    {!notification.readAt && !busy ? (
                      <span className="inline-flex items-center gap-1 font-bold text-brand-700">
                        <RefreshCw size={11} /> Mark read
                      </span>
                    ) : null}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {page?.hasMore ? (
        <div className="flex justify-center">
          <button type="button" onClick={loadMore} disabled={loadingMore} className="btn-ghost">
            {loadingMore ? "Loading…" : "Load older notifications"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
