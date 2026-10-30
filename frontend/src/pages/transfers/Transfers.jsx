import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  LockKeyhole,
  RefreshCw,
  Send,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import Alert from "../../components/ui/Alert";
import EmptyState from "../../components/ui/EmptyState";
import StatusBadge from "../../components/ui/StatusBadge";
import { useAccount } from "../../context/AccountContext";
import { transferFunds } from "../../services/walletService";
import { normalizeApiError } from "../../utils/apiError";
import { formatCurrency, formatDateTime } from "../../utils/format";
import { isKycApproved, kycCopy } from "../../utils/kyc";

const AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,16})(?:\.\d{1,2})?$/;
const WALLET_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const makeIdempotencyKey = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export default function Transfers() {
  const { wallet, kyc, kycUnavailable, loading, refresh: refreshAccount } = useAccount();

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState("form");
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const attempt = useRef({ signature: "", key: null });

  const approved = isKycApproved(kyc);
  const kycGuidance = kycCopy(kyc);
  const currency = wallet?.currency || "ETB";
  const canTransfer = Boolean(wallet?.isActive) && approved;

  const validate = () => {
    const next = {};
    const trimmedRecipient = recipient.trim();
    if (!trimmedRecipient) {
      next.recipient = "Enter the recipient wallet ID.";
    } else if (!WALLET_ID_PATTERN.test(trimmedRecipient)) {
      next.recipient = "Enter a valid wallet ID in UUID format.";
    } else if (trimmedRecipient === wallet?.id) {
      next.recipient = "A wallet cannot transfer to itself.";
    }
    if (!amount) {
      next.amount = "Enter an amount to send.";
    } else if (!AMOUNT_PATTERN.test(amount) || Number(amount) <= 0) {
      next.amount = "Enter a positive amount with no more than two decimal places.";
    }
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  };

  const review = (event) => {
    event.preventDefault();
    setError("");
    if (!validate()) return;
    const signature = `${recipient.trim()}:${amount}`;
    if (attempt.current.signature !== signature || !attempt.current.key) {
      attempt.current = { signature, key: makeIdempotencyKey() };
    }
    setStep("review");
  };

  const confirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const outcome = await transferFunds({
        destinationWalletId: recipient.trim(),
        amount,
        idempotencyKey: attempt.current.key,
      });
      setResult(outcome);
      setStep("result");
      refreshAccount({ silent: true });
    } catch (requestError) {
      setError(normalizeApiError(requestError).message);
    } finally {
      setSubmitting(false);
    }
  };

  const edit = () => {
    setError("");
    setStep("form");
  };

  const startAnother = () => {
    setRecipient("");
    setAmount("");
    setFieldErrors({});
    setError("");
    setResult(null);
    attempt.current = { signature: "", key: null };
    setStep("form");
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <p className="eyebrow">Everyday banking</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-midnight sm:text-[28px]">
            Send money
          </h1>
        </div>
        <div className="card space-y-3 p-6" role="status" aria-label="Loading wallet">
          <div className="skeleton h-4 w-32" />
          <div className="skeleton h-10 w-48" />
          <div className="skeleton h-4 w-64" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Everyday banking</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-midnight sm:text-[28px]">
            Send money
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">
            Transfer ETB to another Meridian wallet. Review the details before the server posts the
            ledger entry.
          </p>
        </div>
        <Link to="/transactions" className="btn-ghost">
          View transactions <ArrowRight size={14} />
        </Link>
      </div>

      {!wallet ? (
        <EmptyState
          icon={WalletCards}
          title="Create a wallet first"
          description="Internal transfers need an active ETB wallet. Create yours to start sending money."
          actionLabel="Go to wallet"
          actionTo="/wallet"
        />
      ) : (
        <>
          {!wallet.isActive ? (
            <Alert tone="warning">
              This wallet is inactive. Transfers are unavailable until it is reactivated.
            </Alert>
          ) : !approved ? (
            <Alert tone="warning">
              <span className="font-bold">
                {kycUnavailable
                  ? "Verification status unavailable."
                  : "Identity verification required."}
              </span>{" "}
              Transfers stay locked until your identity is approved.{" "}
              <Link to={kycGuidance.nextTo} className="font-bold underline underline-offset-2">
                {kycGuidance.nextLabel}
              </Link>
            </Alert>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
            <section className="card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
                <div>
                  <h2 className="text-[15px] font-extrabold text-midnight">
                    {step === "result" ? "Transfer result" : "Transfer details"}
                  </h2>
                  <p className="mt-0.5 text-[12px] text-muted">
                    {step === "form"
                      ? "Enter the recipient wallet and amount."
                      : step === "review"
                        ? "Confirm the exact details before sending."
                        : "The backend has recorded this transfer."}
                  </p>
                </div>
                <ol className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.1em]">
                  {["Details", "Review", "Result"].map((label, index) => {
                    const activeIndex = step === "form" ? 0 : step === "review" ? 1 : 2;
                    const state =
                      index < activeIndex ? "done" : index === activeIndex ? "current" : "next";
                    return (
                      <li
                        key={label}
                        aria-current={state === "current" ? "step" : undefined}
                        className={`rounded-full px-2 py-1 ${
                          state === "current"
                            ? "bg-brand-600 text-white"
                            : state === "done"
                              ? "bg-brand-50 text-brand-700"
                              : "bg-ink-100 text-muted"
                        }`}
                      >
                        {label}
                      </li>
                    );
                  })}
                </ol>
              </div>

              <div className="px-5 py-5">
                {error ? (
                  <Alert tone="error" className="mb-4">
                    {error}
                  </Alert>
                ) : null}

                {step === "form" ? (
                  <form onSubmit={review} className="space-y-4" noValidate>
                    <label className="block space-y-1.5 text-sm font-semibold text-ink-700">
                      Recipient wallet ID
                      <input
                        value={recipient}
                        onChange={(event) => {
                          setRecipient(event.target.value);
                          if (fieldErrors.recipient) {
                            setFieldErrors((current) => ({ ...current, recipient: "" }));
                          }
                        }}
                        placeholder="00000000-0000-0000-0000-000000000000"
                        className="field-input font-mono text-[13px]"
                        autoComplete="off"
                        spellCheck="false"
                        aria-invalid={Boolean(fieldErrors.recipient)}
                      />
                      {fieldErrors.recipient ? (
                        <span className="field-error">{fieldErrors.recipient}</span>
                      ) : (
                        <span className="block text-[11.5px] font-medium leading-relaxed text-muted">
                          Ask the recipient for the wallet ID shown on their wallet page.
                        </span>
                      )}
                    </label>

                    <label className="block space-y-1.5 text-sm font-semibold text-ink-700">
                      Amount (ETB)
                      <input
                        inputMode="decimal"
                        value={amount}
                        onChange={(event) => {
                          setAmount(event.target.value);
                          if (fieldErrors.amount) {
                            setFieldErrors((current) => ({ ...current, amount: "" }));
                          }
                        }}
                        placeholder="0.00"
                        className="field-input num"
                        autoComplete="off"
                        aria-invalid={Boolean(fieldErrors.amount)}
                      />
                      {fieldErrors.amount ? (
                        <span className="field-error">{fieldErrors.amount}</span>
                      ) : (
                        <span className="block text-[11.5px] font-medium text-muted">
                          Available:{" "}
                          <span className="num font-bold text-midnight">
                            {formatCurrency(wallet.balance, currency)}
                          </span>
                        </span>
                      )}
                    </label>

                    <p className="text-[11.5px] leading-relaxed text-muted">
                      The server calculates any applicable fee and enforces transfer limits. Nothing
                      is sent until you confirm on the next step.
                    </p>

                    <button type="submit" disabled={!canTransfer} className="btn-primary w-full">
                      Review transfer <ArrowRight size={15} />
                    </button>
                  </form>
                ) : null}

                {step === "review" ? (
                  <div className="space-y-4">
                    <dl className="divide-y divide-ink-100 rounded-xl border border-ink-200">
                      <div className="flex items-start justify-between gap-4 px-4 py-3">
                        <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
                          From
                        </dt>
                        <dd className="text-right text-[12.5px] font-semibold text-midnight">
                          Your {currency} wallet
                          <span className="mt-0.5 block break-all font-mono text-[10.5px] font-normal text-muted">
                            {wallet.id}
                          </span>
                        </dd>
                      </div>
                      <div className="flex items-start justify-between gap-4 px-4 py-3">
                        <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
                          To
                        </dt>
                        <dd className="max-w-[60%] break-all text-right font-mono text-[11.5px] font-semibold text-midnight">
                          {recipient.trim()}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-4 px-4 py-3">
                        <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
                          Amount
                        </dt>
                        <dd className="num text-lg font-extrabold text-midnight">
                          {formatCurrency(amount, currency)}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-4 px-4 py-3">
                        <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
                          Fee
                        </dt>
                        <dd className="text-[12.5px] font-semibold text-muted">
                          Calculated by the server at posting
                        </dd>
                      </div>
                    </dl>

                    <p className="text-[11.5px] leading-relaxed text-muted">
                      Transfers are final once posted. If the request times out, retrying keeps the
                      same idempotency key so the transfer is never duplicated.
                    </p>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={edit}
                        disabled={submitting}
                        className="btn-ghost"
                      >
                        <ArrowLeft size={15} /> Edit details
                      </button>
                      <button
                        type="button"
                        onClick={confirm}
                        disabled={submitting || !canTransfer}
                        className="btn-primary flex-1 justify-center"
                      >
                        {submitting ? (
                          <>
                            <RefreshCw size={15} className="animate-spin" /> Sending transfer…
                          </>
                        ) : (
                          <>
                            <Send size={15} /> Confirm and send {formatCurrency(amount, currency)}
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ) : null}

                {step === "result" && result ? (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-emerald-200 bg-[#ecfdf3] px-4 py-4">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 size={18} className="text-success" />
                        <p className="text-[13px] font-extrabold text-success">
                          {result.replayed
                            ? "This transfer was already processed"
                            : "Transfer confirmed by the server"}
                        </p>
                      </div>
                      <p className="num mt-2 text-2xl font-extrabold text-midnight">
                        {formatCurrency(result.transaction.amount, result.transaction.currency)}
                      </p>
                      <p className="mt-0.5 text-[12px] text-muted">
                        Sent to{" "}
                        <span className="font-mono">{result.transaction.destinationWalletId}</span>
                      </p>
                    </div>

                    <dl className="divide-y divide-ink-100 rounded-xl border border-ink-200">
                      <div className="flex items-center justify-between gap-4 px-4 py-2.5">
                        <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
                          Status
                        </dt>
                        <dd>
                          <StatusBadge value={result.transaction.status} />
                        </dd>
                      </div>
                      <div className="flex items-start justify-between gap-4 px-4 py-2.5">
                        <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
                          Reference
                        </dt>
                        <dd className="break-all text-right font-mono text-[11.5px] font-semibold text-midnight">
                          {result.transaction.reference}
                        </dd>
                      </div>
                      {Number(result.transaction.feeAmount) > 0 ? (
                        <div className="flex items-center justify-between gap-4 px-4 py-2.5">
                          <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
                            Fee
                          </dt>
                          <dd className="num text-[12.5px] font-semibold text-midnight">
                            {formatCurrency(
                              result.transaction.feeAmount,
                              result.transaction.currency
                            )}
                          </dd>
                        </div>
                      ) : null}
                      <div className="flex items-center justify-between gap-4 px-4 py-2.5">
                        <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
                          Recorded
                        </dt>
                        <dd className="text-[12.5px] font-semibold text-midnight">
                          {formatDateTime(result.transaction.createdAt)}
                        </dd>
                      </div>
                    </dl>

                    <div className="flex flex-wrap gap-2">
                      <Link
                        to={`/transactions/${result.transaction.reference}`}
                        className="btn-primary"
                      >
                        View receipt <ArrowRight size={15} />
                      </Link>
                      <button type="button" onClick={startAnother} className="btn-ghost">
                        Send another
                      </button>
                      <Link to="/wallet" className="btn-ghost">
                        Wallet
                      </Link>
                    </div>
                  </div>
                ) : null}
              </div>
            </section>

            <aside className="space-y-4">
              <section className="card p-5">
                <h2 className="text-[15px] font-extrabold text-midnight">Before you send</h2>
                <ul className="mt-3 space-y-3 text-[12.5px] leading-relaxed text-muted">
                  <li className="flex gap-2.5">
                    <ShieldCheck size={15} className="mt-0.5 shrink-0 text-brand-700" />
                    Every transfer is checked against KYC approval, wallet status, limits, and
                    available balance by the backend.
                  </li>
                  <li className="flex gap-2.5">
                    <LockKeyhole size={15} className="mt-0.5 shrink-0 text-brand-700" />
                    Wallet IDs are exact. A transfer cannot be recalled after it posts, so confirm
                    the recipient UUID carefully.
                  </li>
                  <li className="flex gap-2.5">
                    <RefreshCw size={15} className="mt-0.5 shrink-0 text-brand-700" />A retry after
                    a timeout reuses the same idempotency key, preventing a duplicate debit.
                  </li>
                </ul>
              </section>

              <section className="card p-5">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                  Your available balance
                </p>
                <p className="num mt-1 text-xl font-extrabold text-midnight">
                  {formatCurrency(wallet.balance, currency)}
                </p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
                  Balance is projected from the double-entry ledger and refreshed from the server.
                </p>
              </section>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
