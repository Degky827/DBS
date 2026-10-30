import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpFromLine,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import Alert from "../../components/ui/Alert";
import EmptyState from "../../components/ui/EmptyState";
import StatusBadge from "../../components/ui/StatusBadge";
import { Skeleton } from "../../components/ui/Spinner";
import { ConfirmDialog } from "../../components/ui/Modal";
import { useAccount } from "../../context/AccountContext";
import {
  cancelWithdrawal,
  initiateDeposit,
  initiateWithdrawal,
  listMyPayments,
  verifyDeposit,
} from "../../services/paymentsService";
import { normalizeApiError } from "../../utils/apiError";
import { formatCurrency, formatDateTime } from "../../utils/format";
import { isKycApproved, kycCopy } from "../../utils/kyc";

const AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,16})(?:\.\d{1,2})?$/;
const HISTORY_LIMIT = 8;

const makeIdempotencyKey = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const depositMessage = (payment) => {
  if (payment.status === "COMPLETED") {
    return {
      tone: "success",
      text: "Payment verified by the server. Your wallet has been credited.",
    };
  }
  if (payment.status === "FAILED") {
    return {
      tone: "error",
      text: payment.failureReason || "The provider did not complete this payment.",
    };
  }
  return {
    tone: "info",
    text: "Payment is not confirmed yet. Your wallet has not been credited.",
  };
};

function StepPills({ step, labels }) {
  const activeIndex = Math.max(
    0,
    labels.findIndex((label) => label.key === step)
  );
  return (
    <ol className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.1em]">
      {labels.map((label, index) => {
        const state = index < activeIndex ? "done" : index === activeIndex ? "current" : "next";
        return (
          <li
            key={label.key}
            aria-current={state === "current" ? "step" : undefined}
            className={`rounded-full px-2 py-1 ${
              state === "current"
                ? "bg-brand-600 text-white"
                : state === "done"
                  ? "bg-brand-50 text-brand-700"
                  : "bg-ink-100 text-muted"
            }`}
          >
            {label.label}
          </li>
        );
      })}
    </ol>
  );
}

function PaymentRow({ payment, currency }) {
  return (
    <li className="flex items-start justify-between gap-3 px-5 py-3.5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13px] font-bold text-midnight">Deposit via Chapa</p>
          <StatusBadge value={payment.status} />
        </div>
        <p className="mt-0.5 truncate text-[11.5px] text-muted">
          {formatDateTime(payment.createdAt)} ·{" "}
          <span className="font-mono">{payment.reference}</span>
        </p>
        {payment.failureReason ? (
          <p className="mt-1 text-[11.5px] font-medium text-danger">{payment.failureReason}</p>
        ) : null}
      </div>
      <p className="num shrink-0 text-[13px] font-extrabold text-midnight">
        {formatCurrency(payment.amount, payment.currency || currency)}
      </p>
    </li>
  );
}

export default function Payments() {
  const [searchParams] = useSearchParams();
  const returnReference = searchParams.get("merchant_reference") || "";
  const {
    wallet,
    kyc,
    kycUnavailable,
    loading: accountLoading,
    refresh: refreshAccount,
  } = useAccount();

  const approved = isKycApproved(kyc);
  const kycGuidance = kycCopy(kyc);
  const currency = wallet?.currency || "ETB";
  const canPay = Boolean(wallet?.isActive) && approved;

  const [payments, setPayments] = useState([]);
  const [paymentsPage, setPaymentsPage] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [historyKey, setHistoryKey] = useState(0);

  const [depositAmount, setDepositAmount] = useState("");
  const [depositStep, setDepositStep] = useState("form");
  const [depositError, setDepositError] = useState("");
  const [startingDeposit, setStartingDeposit] = useState(false);
  const [payment, setPayment] = useState(null);
  const [paymentNotice, setPaymentNotice] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [returnChecked, setReturnChecked] = useState(false);
  const depositAttempt = useRef({ signature: "", key: null });

  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawStep, setWithdrawStep] = useState("form");
  const [withdrawError, setWithdrawError] = useState("");
  const [submittingWithdrawal, setSubmittingWithdrawal] = useState(false);
  const [withdrawal, setWithdrawal] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const withdrawAttempt = useRef({ signature: "", key: null });

  useEffect(() => {
    if (accountLoading) return undefined;
    let active = true;
    (async () => {
      setHistoryLoading(true);
      setHistoryError("");
      try {
        const result = await listMyPayments({ limit: HISTORY_LIMIT });
        if (!active) return;
        setPayments(result.payments || []);
        setPaymentsPage(result.page || null);
      } catch (error) {
        if (active) setHistoryError(normalizeApiError(error).message);
      } finally {
        if (active) setHistoryLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [historyKey, accountLoading]);

  useEffect(() => {
    if (!returnReference) return undefined;
    let active = true;
    (async () => {
      setVerifying(true);
      setDepositError("");
      setReturnChecked(false);
      try {
        const verified = await verifyDeposit(returnReference);
        if (!active) return;
        setPayment(verified);
        setPaymentNotice(depositMessage(verified));
        setDepositStep("checkout");
        setHistoryKey((current) => current + 1);
        if (verified.status === "COMPLETED") refreshAccount({ silent: true });
      } catch (requestError) {
        if (active) setDepositError(normalizeApiError(requestError).message);
      } finally {
        if (active) {
          setVerifying(false);
          setReturnChecked(true);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [returnReference, refreshAccount]);

  const loadMorePayments = async () => {
    if (!paymentsPage?.nextCursor || historyLoading) return;
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const result = await listMyPayments({
        limit: HISTORY_LIMIT,
        cursor: paymentsPage.nextCursor,
      });
      setPayments((current) => [...current, ...(result.payments || [])]);
      setPaymentsPage(result.page || null);
    } catch (error) {
      setHistoryError(normalizeApiError(error).message);
    } finally {
      setHistoryLoading(false);
    }
  };

  const reviewDeposit = (event) => {
    event.preventDefault();
    if (!AMOUNT_PATTERN.test(depositAmount) || Number(depositAmount) < 1) {
      setDepositError("Enter an amount of at least 1.00 ETB with no more than two decimal places.");
      return;
    }
    const signature = depositAmount;
    if (depositAttempt.current.signature !== signature || !depositAttempt.current.key) {
      depositAttempt.current = { signature, key: makeIdempotencyKey() };
    }
    setDepositError("");
    setPaymentNotice(null);
    setDepositStep("review");
  };

  const confirmDeposit = async () => {
    if (startingDeposit) return;
    setStartingDeposit(true);
    setDepositError("");
    try {
      const initiated = await initiateDeposit({
        amount: depositAmount,
        idempotencyKey: depositAttempt.current.key,
      });
      setPayment(initiated);
      setPaymentNotice(depositMessage(initiated));
      if (initiated.status === "PENDING" && initiated.checkoutUrl) {
        setDepositStep("checkout");
      } else {
        setDepositStep("result");
        depositAttempt.current = { signature: "", key: null };
      }
      setHistoryKey((current) => current + 1);
      if (initiated.status === "COMPLETED") refreshAccount({ silent: true });
    } catch (requestError) {
      setDepositError(normalizeApiError(requestError).message);
    } finally {
      setStartingDeposit(false);
    }
  };

  const checkPayment = async () => {
    const reference = returnReference || payment?.reference;
    if (!reference || verifying) return;
    setVerifying(true);
    setDepositError("");
    try {
      const verified = await verifyDeposit(reference);
      setPayment(verified);
      setPaymentNotice(depositMessage(verified));
      setHistoryKey((current) => current + 1);
      if (verified.status !== "PENDING") setDepositStep("result");
      if (verified.status === "COMPLETED") refreshAccount({ silent: true });
    } catch (requestError) {
      setDepositError(normalizeApiError(requestError).message);
    } finally {
      setVerifying(false);
    }
  };

  const startAnotherDeposit = () => {
    setDepositAmount("");
    setDepositError("");
    setPaymentNotice(null);
    setPayment(null);
    setDepositStep("form");
    depositAttempt.current = { signature: "", key: null };
  };

  const reviewWithdrawal = (event) => {
    event.preventDefault();
    if (!AMOUNT_PATTERN.test(withdrawAmount) || Number(withdrawAmount) < 1) {
      setWithdrawError(
        "Enter an amount of at least 1.00 ETB with no more than two decimal places."
      );
      return;
    }
    const signature = withdrawAmount;
    if (withdrawAttempt.current.signature !== signature || !withdrawAttempt.current.key) {
      withdrawAttempt.current = { signature, key: makeIdempotencyKey() };
    }
    setWithdrawError("");
    setWithdrawStep("review");
  };

  const confirmWithdrawal = async () => {
    if (submittingWithdrawal) return;
    setSubmittingWithdrawal(true);
    setWithdrawError("");
    try {
      const reserved = await initiateWithdrawal({
        amount: withdrawAmount,
        idempotencyKey: withdrawAttempt.current.key,
      });
      setWithdrawal(reserved);
      setWithdrawStep("result");
      withdrawAttempt.current = { signature: "", key: null };
      refreshAccount({ silent: true });
    } catch (requestError) {
      setWithdrawError(normalizeApiError(requestError).message);
    } finally {
      setSubmittingWithdrawal(false);
    }
  };

  const confirmCancel = async () => {
    if (!withdrawal || cancelling) return;
    setCancelling(true);
    setWithdrawError("");
    try {
      const cancelled = await cancelWithdrawal(withdrawal.reference);
      setWithdrawal(cancelled);
      setCancelOpen(false);
      refreshAccount({ silent: true });
    } catch (requestError) {
      setWithdrawError(normalizeApiError(requestError).message);
    } finally {
      setCancelling(false);
    }
  };

  const startAnotherWithdrawal = () => {
    setWithdrawAmount("");
    setWithdrawError("");
    setWithdrawal(null);
    setWithdrawStep("form");
    withdrawAttempt.current = { signature: "", key: null };
  };

  const depositPills = [
    { key: "form", label: "Amount" },
    { key: "review", label: "Review" },
    { key: "checkout", label: "Checkout" },
    { key: "result", label: "Result" },
  ];
  const withdrawPills = [
    { key: "form", label: "Amount" },
    { key: "review", label: "Review" },
    { key: "result", label: "Result" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Funding and payouts</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-midnight sm:text-[28px]">
            Payments
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">
            Fund your wallet through Chapa Test Mode, reserve withdrawals, and track every payment
            result the server has recorded.
          </p>
        </div>
        <span className="badge-warning">Chapa Test Mode</span>
      </div>

      <Alert tone="warning">
        Payments use Chapa Test Mode only. Do not enter real payment details. The browser return URL
        is not proof of payment: the backend verifies status, merchant reference, amount, and
        currency with Chapa before crediting your wallet.
      </Alert>

      {!accountLoading && !wallet ? (
        <EmptyState
          icon={WalletCards}
          title="Create a wallet first"
          description="Deposits and withdrawals need an ETB wallet. Create yours to start funding it."
          actionLabel="Go to wallet"
          actionTo="/wallet"
        />
      ) : !accountLoading && !approved ? (
        <Alert tone="warning">
          <span className="font-bold">
            {kycUnavailable
              ? "Verification status unavailable."
              : "Identity verification required."}
          </span>{" "}
          Deposits and withdrawals stay locked until your identity is approved.{" "}
          <Link to={kycGuidance.nextTo} className="font-bold underline underline-offset-2">
            {kycGuidance.nextLabel}
          </Link>
        </Alert>
      ) : !accountLoading && !wallet.isActive ? (
        <Alert tone="warning">
          This wallet is inactive. Deposits and withdrawals are unavailable until it is reactivated.
        </Alert>
      ) : null}

      {returnReference && verifying ? (
        <div className="card p-5 text-sm font-semibold text-muted" role="status">
          Verifying your payment with Chapa…
        </div>
      ) : null}
      {returnReference && returnChecked && payment ? (
        <section className="card flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <p className="flex items-center gap-2 text-sm font-bold text-midnight">
              Return verification <StatusBadge value={payment.status} />
            </p>
            <p className="mt-1 text-xs text-muted">
              Reference {payment.reference} · {payment.amount} {payment.currency}
            </p>
          </div>
          <button type="button" onClick={checkPayment} disabled={verifying} className="btn-ghost">
            <RefreshCw size={15} className={verifying ? "animate-spin" : ""} /> Check status
          </button>
        </section>
      ) : null}

      {wallet ? (
        <section className="grid gap-4 xl:grid-cols-2">
          <article id="deposit" className="card scroll-mt-24 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                  <ArrowDownToLine size={19} />
                </span>
                <div>
                  <h2 className="text-[15px] font-extrabold text-midnight">Deposit to wallet</h2>
                  <p className="mt-0.5 text-[12px] text-muted">
                    Hosted Chapa Test Mode checkout · minimum 1.00 ETB
                  </p>
                </div>
              </div>
              <StepPills step={depositStep} labels={depositPills} />
            </div>

            <div className="px-5 py-5">
              {depositError ? (
                <Alert tone="error" className="mb-4">
                  {depositError}
                </Alert>
              ) : null}
              {paymentNotice ? (
                <Alert tone={paymentNotice.tone} className="mb-4">
                  {paymentNotice.text}
                </Alert>
              ) : null}

              {depositStep === "form" ? (
                <form onSubmit={reviewDeposit} className="space-y-4" noValidate>
                  <label className="block space-y-1.5 text-sm font-semibold text-ink-700">
                    Amount (ETB)
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={depositAmount}
                      onChange={(event) => setDepositAmount(event.target.value)}
                      placeholder="1.00"
                      className="field-input num"
                    />
                  </label>
                  <p className="text-[11.5px] leading-relaxed text-muted">
                    Chapa receives the exact amount you enter. Your wallet is credited only after
                    the backend verifies a matching successful payment.
                  </p>
                  <button type="submit" disabled={!canPay} className="btn-primary w-full">
                    Review deposit <ArrowRight size={15} />
                  </button>
                </form>
              ) : null}

              {depositStep === "review" ? (
                <div className="space-y-4">
                  <dl className="divide-y divide-ink-100 rounded-xl border border-ink-200">
                    <div className="flex items-center justify-between gap-4 px-4 py-3">
                      <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
                        Deposit
                      </dt>
                      <dd className="num text-lg font-extrabold text-midnight">
                        {formatCurrency(depositAmount, currency)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-4 px-4 py-3">
                      <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
                        Method
                      </dt>
                      <dd className="text-[12.5px] font-semibold text-midnight">
                        Chapa Test Mode checkout
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-4 px-4 py-3">
                      <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
                        Credited to
                      </dt>
                      <dd className="text-[12.5px] font-semibold text-midnight">
                        Your {currency} wallet
                      </dd>
                    </div>
                  </dl>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDepositError("");
                        setDepositStep("form");
                      }}
                      disabled={startingDeposit}
                      className="btn-ghost"
                    >
                      <ArrowLeft size={15} /> Edit amount
                    </button>
                    <button
                      type="button"
                      onClick={confirmDeposit}
                      disabled={startingDeposit || !canPay}
                      className="btn-primary flex-1 justify-center"
                    >
                      {startingDeposit ? (
                        <>
                          <RefreshCw size={15} className="animate-spin" /> Preparing checkout…
                        </>
                      ) : (
                        <>
                          <CreditCard size={15} /> Confirm and open checkout
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ) : null}

              {depositStep === "checkout" && payment ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-ink-200 bg-ink-50 px-4 py-3.5">
                    <p className="flex flex-wrap items-center gap-2 text-[13px] font-bold text-midnight">
                      Payment <StatusBadge value={payment.status} />
                    </p>
                    <p className="mt-1 text-[12px] text-muted">
                      {payment.amount} {payment.currency} · Reference{" "}
                      <span className="font-mono">{payment.reference}</span>
                    </p>
                  </div>
                  {payment.checkoutUrl && payment.status === "PENDING" ? (
                    <a
                      href={payment.checkoutUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-primary w-full"
                    >
                      Continue to Chapa checkout <ExternalLink size={15} />
                    </a>
                  ) : null}
                  <button
                    type="button"
                    onClick={checkPayment}
                    disabled={verifying}
                    className="btn-secondary w-full"
                  >
                    <RefreshCw size={15} className={verifying ? "animate-spin" : ""} />
                    {verifying
                      ? "Checking with the server…"
                      : "I completed checkout — check status"}
                  </button>
                  <p className="text-[11.5px] leading-relaxed text-muted">
                    Status changes only when the server verifies the payment with Chapa. A browser
                    return or manually opening the return URL does not credit the wallet.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={startAnotherDeposit} className="btn-ghost">
                      New deposit
                    </button>
                    <Link to="/transactions" className="btn-ghost">
                      View wallet activity
                    </Link>
                  </div>
                </div>
              ) : null}

              {depositStep === "result" && payment ? (
                <div className="space-y-4">
                  <div
                    className={`rounded-xl border px-4 py-4 ${
                      payment.status === "COMPLETED"
                        ? "border-emerald-200 bg-[#ecfdf3]"
                        : payment.status === "FAILED"
                          ? "border-red-200 bg-red-50"
                          : "border-ink-200 bg-ink-50"
                    }`}
                  >
                    <p className="flex items-center gap-2 text-[13px] font-extrabold text-midnight">
                      {payment.status === "COMPLETED" ? (
                        <CheckCircle2 size={17} className="text-success" />
                      ) : null}
                      {payment.status === "COMPLETED"
                        ? "Deposit credited"
                        : payment.status === "FAILED"
                          ? "Payment failed"
                          : "Payment pending"}
                    </p>
                    <p className="num mt-2 text-2xl font-extrabold text-midnight">
                      {formatCurrency(payment.amount, payment.currency || currency)}
                    </p>
                    <p className="mt-0.5 break-all text-[11.5px] text-muted">
                      Reference <span className="font-mono">{payment.reference}</span>
                    </p>
                    {payment.failureReason ? (
                      <p className="mt-2 text-[12px] font-medium text-danger">
                        {payment.failureReason}
                      </p>
                    ) : null}
                    <div className="mt-2">
                      <StatusBadge value={payment.status} />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {payment.status !== "COMPLETED" ? (
                      <button
                        type="button"
                        onClick={checkPayment}
                        disabled={verifying}
                        className="btn-primary"
                      >
                        <RefreshCw size={15} className={verifying ? "animate-spin" : ""} /> Check
                        status
                      </button>
                    ) : null}
                    <button type="button" onClick={startAnotherDeposit} className="btn-ghost">
                      New deposit
                    </button>
                    <Link to="/wallet" className="btn-ghost">
                      View wallet
                    </Link>
                  </div>
                </div>
              ) : null}
            </div>
          </article>

          <article id="withdraw" className="card scroll-mt-24 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#fffbeb] text-warning">
                  <ArrowUpFromLine size={19} />
                </span>
                <div>
                  <h2 className="text-[15px] font-extrabold text-midnight">Withdraw funds</h2>
                  <p className="mt-0.5 text-[12px] text-muted">
                    Reserve funds internally · cancel to release them
                  </p>
                </div>
              </div>
              <StepPills step={withdrawStep} labels={withdrawPills} />
            </div>

            <div className="px-5 py-5">
              {withdrawError ? (
                <Alert tone="error" className="mb-4">
                  {withdrawError}
                </Alert>
              ) : null}

              <Alert tone="info" className="mb-4">
                No external payout provider is integrated. A withdrawal reserves the amount in your
                wallet and stays pending until you cancel it; cancellation returns the funds through
                the ledger.
              </Alert>

              {withdrawStep === "form" ? (
                <form onSubmit={reviewWithdrawal} className="space-y-4" noValidate>
                  <label className="block space-y-1.5 text-sm font-semibold text-ink-700">
                    Amount (ETB)
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={withdrawAmount}
                      onChange={(event) => setWithdrawAmount(event.target.value)}
                      placeholder="1.00"
                      className="field-input num"
                    />
                    <span className="block text-[11.5px] font-medium text-muted">
                      Available:{" "}
                      <span className="num font-bold text-midnight">
                        {wallet ? formatCurrency(wallet.balance, currency) : "—"}
                      </span>
                    </span>
                  </label>
                  <button type="submit" disabled={!canPay} className="btn-primary w-full">
                    Review withdrawal <ArrowRight size={15} />
                  </button>
                </form>
              ) : null}

              {withdrawStep === "review" ? (
                <div className="space-y-4">
                  <dl className="divide-y divide-ink-100 rounded-xl border border-ink-200">
                    <div className="flex items-center justify-between gap-4 px-4 py-3">
                      <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
                        Reserve
                      </dt>
                      <dd className="num text-lg font-extrabold text-midnight">
                        {formatCurrency(withdrawAmount, currency)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-4 px-4 py-3">
                      <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
                        From
                      </dt>
                      <dd className="text-[12.5px] font-semibold text-midnight">
                        Your {currency} wallet
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-4 px-4 py-3">
                      <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
                        Effect
                      </dt>
                      <dd className="max-w-[60%] text-right text-[12px] font-semibold text-muted">
                        Funds move to the withdrawal reserve account
                      </dd>
                    </div>
                  </dl>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setWithdrawError("");
                        setWithdrawStep("form");
                      }}
                      disabled={submittingWithdrawal}
                      className="btn-ghost"
                    >
                      <ArrowLeft size={15} /> Edit amount
                    </button>
                    <button
                      type="button"
                      onClick={confirmWithdrawal}
                      disabled={submittingWithdrawal || !canPay}
                      className="btn-primary flex-1 justify-center"
                    >
                      {submittingWithdrawal ? (
                        <>
                          <RefreshCw size={15} className="animate-spin" /> Reserving funds…
                        </>
                      ) : (
                        <>
                          <LockKeyhole size={15} /> Confirm reservation
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ) : null}

              {withdrawStep === "result" && withdrawal ? (
                <div className="space-y-4">
                  <div
                    className={`rounded-xl border px-4 py-4 ${
                      withdrawal.status === "CANCELLED"
                        ? "border-ink-200 bg-ink-50"
                        : "border-[#fde68a] bg-[#fffbeb]"
                    }`}
                  >
                    <p className="flex flex-wrap items-center gap-2 text-[13px] font-extrabold text-midnight">
                      {withdrawal.status === "CANCELLED"
                        ? "Withdrawal cancelled"
                        : "Withdrawal reserved"}
                      <StatusBadge value={withdrawal.status} />
                    </p>
                    <p className="num mt-2 text-2xl font-extrabold text-midnight">
                      {formatCurrency(withdrawal.amount, withdrawal.currency || currency)}
                    </p>
                    <p className="mt-0.5 break-all text-[11.5px] text-muted">
                      Reference <span className="font-mono">{withdrawal.reference}</span>
                    </p>
                    <p className="mt-0.5 break-all text-[11.5px] text-muted">
                      Ledger entry{" "}
                      <span className="font-mono">{withdrawal.ledgerEntryReference || "—"}</span>
                    </p>
                    <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
                      {withdrawal.status === "CANCELLED"
                        ? "The reserved amount was returned to your available balance."
                        : "The reserved amount is held until you cancel this withdrawal. No external payout occurs."}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {withdrawal.status === "PENDING" ? (
                      <button
                        type="button"
                        onClick={() => setCancelOpen(true)}
                        className="btn-danger-outline"
                      >
                        Cancel withdrawal
                      </button>
                    ) : null}
                    <button type="button" onClick={startAnotherWithdrawal} className="btn-ghost">
                      New withdrawal
                    </button>
                    <Link to="/wallet" className="btn-ghost">
                      View wallet
                    </Link>
                  </div>
                </div>
              ) : null}
            </div>
          </article>
        </section>
      ) : null}

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
          <div>
            <h2 className="text-[15px] font-extrabold text-midnight">Recent payments</h2>
            <p className="mt-0.5 text-[12px] text-muted">
              Deposit records reported by the wallet service, newest first.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setHistoryKey((current) => current + 1)}
            disabled={historyLoading}
            className="btn-ghost"
          >
            <RefreshCw size={15} className={historyLoading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>

        {historyError ? (
          <div className="px-5 py-4">
            <Alert tone="error">{historyError}</Alert>
          </div>
        ) : null}

        {historyLoading && payments.length === 0 ? (
          <div className="space-y-3 px-5 py-5" role="status" aria-label="Loading payments">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : payments.length === 0 ? (
          <div className="px-5 py-10">
            <EmptyState
              className="border-none shadow-none"
              icon={CreditCard}
              title="No payments yet"
              description="Deposits you start in Chapa Test Mode will appear here with their server-verified status."
            />
          </div>
        ) : (
          <ul className="divide-y divide-ink-100">
            {payments.map((entry) => (
              <PaymentRow key={entry.id} payment={entry} currency={currency} />
            ))}
          </ul>
        )}

        {paymentsPage?.hasMore ? (
          <div className="border-t border-ink-100 px-5 py-3">
            <button
              type="button"
              onClick={loadMorePayments}
              disabled={historyLoading}
              className="btn-ghost w-full justify-center"
            >
              {historyLoading ? "Loading…" : "Load more payments"}
            </button>
          </div>
        ) : null}
      </section>

      <section className="card flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-start gap-3">
          <ShieldCheck size={19} className="mt-0.5 shrink-0 text-brand-600" />
          <div>
            <h2 className="font-extrabold text-midnight">Server-verified payments</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
              Only a verified Chapa Test Mode success that matches this payment’s reference, amount,
              and ETB currency is credited. Duplicate webhook deliveries are idempotent, and
              withdrawals never leave the ledger without approval.
            </p>
          </div>
        </div>
        <Link to="/wallet" className="btn-primary shrink-0">
          <WalletCards size={16} /> View wallet
        </Link>
      </section>

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={confirmCancel}
        title="Cancel this withdrawal?"
        description="The reserved amount returns to your available balance through a ledger entry."
        confirmLabel="Cancel withdrawal"
        cancelLabel="Keep reserved"
        busy={cancelling}
      >
        {withdrawal ? (
          <p className="text-[13px] leading-relaxed text-muted">
            Reference <span className="font-mono">{withdrawal.reference}</span> ·{" "}
            <span className="num font-bold text-midnight">
              {formatCurrency(withdrawal.amount, withdrawal.currency || currency)}
            </span>
          </p>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
