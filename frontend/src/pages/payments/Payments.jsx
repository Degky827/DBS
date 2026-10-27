import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CircleAlert,
  CreditCard,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import Alert from "../../components/ui/Alert";
import PageHeader from "../../components/ui/PageHeader";
import { initiateDeposit, verifyDeposit } from "../../services/paymentsService";
import { normalizeApiError } from "../../utils/apiError";

const AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,16})(?:\.\d{1,2})?$/;

const makeIdempotencyKey = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const paymentMessage = (payment) => {
  if (payment.status === "COMPLETED") {
    return { tone: "success", text: "Payment verified. Your wallet has been credited." };
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

export default function Payments() {
  const [searchParams] = useSearchParams();
  const returnReference = searchParams.get("merchant_reference") || "";
  const [amount, setAmount] = useState("");
  const [payment, setPayment] = useState(null);
  const [starting, setStarting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(null);
  const [returnChecked, setReturnChecked] = useState(false);
  const idempotencyKey = useRef(null);
  const requestSignature = useRef("");

  useEffect(() => {
    if (!returnReference) return undefined;
    let active = true;
    const checkPayment = async () => {
      setVerifying(true);
      setError("");
      setReturnChecked(false);
      try {
        const verified = await verifyDeposit(returnReference);
        if (active) {
          setPayment(verified);
          setNotice(paymentMessage(verified));
        }
      } catch (requestError) {
        if (active) setError(normalizeApiError(requestError).message);
      } finally {
        if (active) {
          setVerifying(false);
          setReturnChecked(true);
        }
      }
    };
    checkPayment();
    return () => {
      active = false;
    };
  }, [returnReference]);

  const handleDeposit = async (event) => {
    event.preventDefault();
    if (!AMOUNT_PATTERN.test(amount) || Number(amount) < 1) {
      setError("Enter an amount of at least 1.00 ETB with no more than two decimal places.");
      return;
    }

    const signature = amount;
    if (signature !== requestSignature.current) {
      requestSignature.current = signature;
      idempotencyKey.current = makeIdempotencyKey();
    }

    setStarting(true);
    setError("");
    setNotice(null);
    try {
      const initiated = await initiateDeposit({
        amount,
        idempotencyKey: idempotencyKey.current,
      });
      setPayment(initiated);
      if (initiated.status === "COMPLETED") {
        setNotice(paymentMessage(initiated));
        idempotencyKey.current = null;
        requestSignature.current = "";
      } else if (initiated.checkoutUrl) {
        setNotice({
          tone: "info",
          text: "Checkout is ready in Chapa Test Mode. Your wallet will only be credited after server-side verification.",
        });
      }
    } catch (requestError) {
      setError(normalizeApiError(requestError).message);
    } finally {
      setStarting(false);
    }
  };

  const refreshPayment = async () => {
    const reference = returnReference || payment?.reference;
    if (!reference) return;
    setVerifying(true);
    setError("");
    try {
      const verified = await verifyDeposit(reference);
      setPayment(verified);
      setNotice(paymentMessage(verified));
    } catch (requestError) {
      setError(normalizeApiError(requestError).message);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Funding and payouts"
        title="Payments"
        description="Deposits are available only when the backend is configured with Chapa Test Mode credentials."
        actions={<span className="badge-warning">Test mode only</span>}
      />

      <Alert tone="warning">
        Payments use Chapa Test Mode only. Do not enter real payment details. The browser return
        URL is not proof of payment: the backend verifies status, merchant reference, amount, and
        currency with Chapa before crediting your wallet.
      </Alert>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      {returnReference && verifying ? (
        <div className="card p-5 text-sm font-semibold text-ink-500" role="status">
          Verifying your payment with Chapa…
        </div>
      ) : null}
      {returnReference && returnChecked && !error && payment ? (
        <section className="card flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <p className="text-sm font-bold text-navy-900">Payment status: {payment.status}</p>
            <p className="mt-1 text-xs text-ink-500">
              Reference {payment.reference} · {payment.amount} {payment.currency}
            </p>
          </div>
          <button type="button" onClick={refreshPayment} disabled={verifying} className="btn-ghost">
            <RefreshCw size={15} /> Check status
          </button>
        </section>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="card p-5 sm:p-6">
          <div className="mb-5 flex items-start gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-navy-50 text-navy-700">
              <ArrowDownToLine size={19} />
            </span>
            <div>
              <h2 className="text-lg font-extrabold text-navy-900">Deposit to wallet</h2>
              <p className="mt-1 text-sm leading-relaxed text-ink-500">
                Open a hosted Chapa Test Mode checkout. Minimum deposit is 1.00 ETB.
              </p>
            </div>
          </div>
          <form onSubmit={handleDeposit} className="space-y-4">
            <label className="block space-y-1.5 text-sm font-semibold text-ink-700">
              Amount (ETB)
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="1.00"
                className="field-input"
                required
              />
            </label>
            <button type="submit" disabled={starting || verifying} className="btn-primary w-full">
              <CreditCard size={16} />
              {starting ? "Preparing checkout…" : "Prepare test checkout"}
            </button>
          </form>
          {payment?.checkoutUrl && payment.status === "PENDING" ? (
            <a
              href={payment.checkoutUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary mt-3 w-full"
            >
              Continue to Chapa checkout <ExternalLink size={15} />
            </a>
          ) : null}
          {payment ? (
            <p className="mt-4 break-all text-xs text-ink-400">
              Internal reference: {payment.reference}
            </p>
          ) : null}
        </article>

        <article className="card p-5 sm:p-6">
          <div className="mb-4 flex items-start gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-ink-100 text-ink-500">
              <ArrowUpFromLine size={19} />
            </span>
            <div>
              <h2 className="text-lg font-extrabold text-navy-900">Withdrawals</h2>
              <p className="mt-1 text-sm leading-relaxed text-ink-500">
                Payouts are not implemented. This service will not submit a withdrawal or change
                your balance for one.
              </p>
            </div>
          </div>
          <div className="rounded-lg border border-ink-200 bg-ink-50 p-4 text-sm font-semibold text-ink-500">
            <CircleAlert size={16} className="mr-2 inline text-amber-600" />
            Withdrawals unavailable
          </div>
        </article>
      </section>

      <section className="card flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-start gap-3">
          <ShieldCheck size={19} className="mt-0.5 shrink-0 text-navy-600" />
          <div>
            <h2 className="font-extrabold text-navy-900">Server-verified payments</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-500">
              Only a verified Chapa Test Mode success that matches this payment’s reference,
              amount, and ETB currency is credited. Duplicate webhook deliveries are idempotent.
            </p>
          </div>
        </div>
        <Link to="/wallet" className="btn-primary shrink-0">
          <CreditCard size={16} /> View wallet
        </Link>
      </section>
    </div>
  );
}
