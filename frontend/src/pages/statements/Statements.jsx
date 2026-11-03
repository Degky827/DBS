import { useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Download, FileText, WalletCards } from "lucide-react";
import PageHeader from "../../components/ui/PageHeader";
import Alert from "../../components/ui/Alert";
import EmptyState from "../../components/ui/EmptyState";
import StatusBadge from "../../components/ui/StatusBadge";
import { LoadingBlock } from "../../components/ui/Spinner";
import { useAccount } from "../../context/AccountContext";
import { downloadStatementPdf, getStatement } from "../../services/statementsService";
import { normalizeApiError } from "../../utils/apiError";
import { formatCurrency, formatDate, titleCase } from "../../utils/format";

const isoDay = (date) => date.toISOString().slice(0, 10);
const DAY_MS = 24 * 60 * 60 * 1000;

const presetRange = (key) => {
  const now = new Date();
  if (key === "current-month") {
    return {
      from: isoDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))),
      to: isoDay(now),
    };
  }
  if (key === "year") {
    return { from: isoDay(new Date(Date.UTC(now.getUTCFullYear(), 0, 1))), to: isoDay(now) };
  }
  const days = key === "90d" ? 89 : 29;
  return { from: isoDay(new Date(Date.now() - days * DAY_MS)), to: isoDay(now) };
};

const SummaryTile = ({ label, value, tone }) => (
  <div className="rounded-xl border border-ink-200 bg-white px-4 py-3.5">
    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">{label}</p>
    <p
      className={`num mt-1.5 text-lg font-extrabold ${
        tone === "in" ? "text-success" : tone === "out" ? "text-danger" : "text-midnight"
      }`}
    >
      {value}
    </p>
  </div>
);

export default function Statements() {
  const { wallet, loading: accountLoading } = useAccount();
  const [range, setRange] = useState(() => presetRange("30d"));
  const [applied, setApplied] = useState(range);
  const [statement, setStatement] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!wallet) return undefined;
    let active = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const data = await getStatement(applied);
        if (!active) return;
        setStatement(data);
      } catch (requestError) {
        if (!active) return;
        setStatement(null);
        setError(normalizeApiError(requestError).message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [wallet, applied]);

  const applyPreset = (key) => {
    const next = presetRange(key);
    setRange(next);
    setApplied(next);
  };

  const submit = (event) => {
    event.preventDefault();
    if (!range.from || !range.to) {
      setError("Choose both a start and an end date.");
      return;
    }
    if (range.from > range.to) {
      setError("The start date must be on or before the end date.");
      return;
    }
    setApplied({ ...range });
  };

  const download = async () => {
    setDownloading(true);
    setError("");
    try {
      await downloadStatementPdf(applied);
    } catch (requestError) {
      setError(normalizeApiError(requestError).message);
    } finally {
      setDownloading(false);
    }
  };

  const currency = statement?.account?.currency || wallet?.currency || "ETB";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Everyday banking"
        title="Account statement"
        description="Pick a period to see every posted entry with its running balance, then export the same statement as a signed PDF for your records or a visa application."
        actions={
          <button
            type="button"
            onClick={download}
            disabled={!statement || loading || downloading}
            className="btn-primary"
          >
            {downloading ? <LoadingBlockInline /> : <Download size={15} />} Export PDF
          </button>
        }
      />

      {accountLoading ? (
        <LoadingBlock label="Loading your wallet…" />
      ) : !wallet ? (
        <EmptyState
          icon={WalletCards}
          title="Create a wallet first"
          description="Statements are generated from your wallet ledger, which is available after you create a wallet."
          actionLabel="Go to wallet"
          actionTo="/wallet"
        />
      ) : (
        <>
          <section className="card p-5">
            <form
              onSubmit={submit}
              className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_auto_auto]"
            >
              <label className="space-y-1 text-xs font-bold text-ink-500">
                From
                <input
                  type="date"
                  value={range.from}
                  max={range.to || undefined}
                  onChange={(event) =>
                    setRange((current) => ({ ...current, from: event.target.value }))
                  }
                  className="field-input"
                />
              </label>
              <label className="space-y-1 text-xs font-bold text-ink-500">
                To
                <input
                  type="date"
                  value={range.to}
                  min={range.from || undefined}
                  onChange={(event) =>
                    setRange((current) => ({ ...current, to: event.target.value }))
                  }
                  className="field-input"
                />
              </label>
              <div className="flex items-end gap-2">
                <button type="submit" disabled={loading} className="btn-primary">
                  <FileText size={15} /> Generate
                </button>
              </div>
              <div className="flex flex-wrap items-end gap-1.5">
                {[
                  ["30d", "Last 30 days"],
                  ["90d", "Last 90 days"],
                  ["current-month", "This month"],
                  ["year", "This year"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => applyPreset(key)}
                    disabled={loading}
                    className="btn-ghost !px-3 !py-1.5 text-[12px]"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </form>
          </section>

          {error ? (
            <Alert tone="error" dismissible onDismiss={() => setError("")}>
              {error}
            </Alert>
          ) : null}

          {loading ? (
            <LoadingBlock label="Building your statement…" />
          ) : !statement ? null : (
            <>
              <section className="card p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="eyebrow">Statement period</p>
                    <h2 className="mt-1 text-[17px] font-extrabold text-midnight">
                      {formatDate(statement.period.from)} – {formatDate(statement.period.to)}
                    </h2>
                    <p className="mt-1 text-[12.5px] text-muted">
                      {statement.account.holder} · {statement.account.email || "—"} · wallet{" "}
                      <span className="font-mono">{statement.account.walletId.slice(0, 8)}</span>
                    </p>
                  </div>
                  <span className="badge-info">{statement.account.currency} wallet</span>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <SummaryTile
                    label="Opening balance"
                    value={formatCurrency(statement.openingBalance, currency)}
                  />
                  <SummaryTile
                    label="Closing balance"
                    value={formatCurrency(statement.closingBalance, currency)}
                  />
                  <SummaryTile
                    label="Money in"
                    tone="in"
                    value={formatCurrency(statement.totals.incoming, currency)}
                  />
                  <SummaryTile
                    label="Money out"
                    tone="out"
                    value={formatCurrency(statement.totals.outgoing, currency)}
                  />
                </div>
                <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
                  {statement.totals.transactions} posted{" "}
                  {statement.totals.transactions === 1 ? "entry" : "entries"} in this period.
                  Balances are recalculated from the ledger, so reversals and fees are included.
                </p>
              </section>

              {statement.transactions.length === 0 ? (
                <EmptyState
                  icon={FileText}
                  title="No activity in this period"
                  description="Choose a different date range to generate a statement with entries."
                />
              ) : (
                <section className="card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="data-table min-w-[760px]">
                      <thead>
                        <tr>
                          <th scope="col">Date</th>
                          <th scope="col">Reference</th>
                          <th scope="col">Type</th>
                          <th scope="col">Status</th>
                          <th scope="col" className="text-right">
                            Amount
                          </th>
                          <th scope="col" className="text-right">
                            Balance
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {statement.transactions.map((row) => {
                          const outgoing = row.direction === "OUTGOING";
                          return (
                            <tr key={row.reference}>
                              <td className="whitespace-nowrap text-[12.5px] text-body">
                                {formatDate(row.createdAt)}
                              </td>
                              <td>
                                <span className="block max-w-[150px] truncate font-mono text-[11px] text-muted">
                                  {row.reference}
                                </span>
                              </td>
                              <td className="text-[12.5px] text-muted">{titleCase(row.type)}</td>
                              <td>
                                <StatusBadge value={row.status} />
                              </td>
                              <td
                                className={`num whitespace-nowrap text-right text-[13px] font-extrabold ${
                                  outgoing ? "text-midnight" : "text-success"
                                }`}
                              >
                                {outgoing ? (
                                  <ArrowUpRight size={12} className="mr-1 inline" />
                                ) : null}
                                {outgoing ? "−" : "+"}
                                {formatCurrency(row.amount, row.currency || currency)}
                              </td>
                              <td className="num whitespace-nowrap text-right text-[13px] font-bold text-ink-500">
                                {formatCurrency(row.balanceAfter, row.currency || currency)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="border-t border-ink-100 px-5 py-3 text-[11.5px] text-muted">
                    <ArrowDownLeft size={12} className="mr-1 inline" />
                    Incoming entries increase the running balance; fees and reversals are applied in
                    the period they were posted.
                  </p>
                </section>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function LoadingBlockInline() {
  return (
    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
  );
}
