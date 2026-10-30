import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, MailCheck } from "lucide-react";
import { forgotPassword } from "../../services/authService";
import { normalizeApiError } from "../../utils/apiError";
import { Spinner } from "../../components/ui/Spinner";
import PageTransition from "../../components/ui/PageTransition";

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setError("Enter a valid email address");
      return;
    }
    setError("");
    setSubmitting(true);

    try {
      await forgotPassword(email);
      setSent(true);
    } catch (err) {
      const { message } = normalizeApiError(err);
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <PageTransition>
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 ring-8 ring-emerald-50/60">
          <MailCheck size={22} />
        </span>
        <h1 className="mt-5 text-[32px] font-extrabold leading-tight text-midnight">
          Check your inbox
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">
          If an account exists for{" "}
          <span className="font-semibold text-midnight">{email}</span>, a 6-digit reset
          code is on its way. It expires in 10 minutes.
        </p>

        <button
          type="button"
          className="btn-brand mt-6 w-full"
          onClick={() => navigate("/reset-password", { state: { email } })}
        >
          I have the code <ArrowRight size={17} />
        </button>

        <p className="mt-5 text-center text-sm text-muted">
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 font-semibold text-brand-700 hover:underline"
          >
            <ArrowLeft size={14} /> Back to sign in
          </Link>
        </p>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand-700">
        Account recovery
      </p>
      <h1 className="mt-3 text-[32px] font-extrabold leading-tight text-midnight">
        Forgot your password?
      </h1>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">
        Enter the email on your account and we&apos;ll send a one-time code to reset it.
      </p>

      <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-5">
        <div>
          <label htmlFor="email" className="field-label">Email address</label>
          <input
            id="email"
            type="email"
            className="field-input"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            aria-invalid={error ? "true" : undefined}
          />
          {error && <p className="field-error">{error}</p>}
        </div>

        <button type="submit" className="btn-brand w-full" disabled={submitting}>
          {submitting ? (
            <>
              <Spinner size={17} /> Sending code…
            </>
          ) : (
            <>
              Send reset code <ArrowRight size={17} />
            </>
          )}
        </button>
      </form>

      <div className="mt-8 rounded-xl border border-ink-200 bg-ink-50 px-4 py-3 text-[12.5px] leading-relaxed text-muted">
        Remembered it?{" "}
        <Link to="/login" className="font-semibold text-brand-700 hover:underline">
          Back to sign in
        </Link>
      </div>
    </PageTransition>
  );
}
