import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Loader2, MailCheck } from "lucide-react";

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setError("Enter a valid email address");
      return;
    }
    setError("");
    setSubmitting(true);
    // UI-only demo: pretends the reset code was issued.
    setTimeout(() => {
      setSubmitting(false);
      setSent(true);
    }, 700);
  };

  if (sent) {
    return (
      <div>
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-8 ring-emerald-50/60">
          <MailCheck size={22} />
        </span>
        <h1 className="mt-5 text-3xl font-extrabold">Check your inbox</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-500">
          If an account exists for{" "}
          <span className="font-semibold text-navy-900">{email}</span>, a 6-digit reset
          code is on its way. It expires in 10 minutes.
        </p>

        <button type="button" className="btn-primary mt-6" onClick={() => navigate("/reset-password", { state: { email } })}>
          I have the code <ArrowRight size={17} />
        </button>

        <p className="mt-5 text-center text-sm text-ink-500">
          <Link to="/" className="link inline-flex items-center gap-1.5">
            <ArrowLeft size={14} /> Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="eyebrow">Account recovery</p>
      <h1 className="mt-2 text-3xl font-extrabold">Forgot your password?</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-500">
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
          />
          {error && <p className="field-error">{error}</p>}
        </div>

        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 size={17} className="animate-spin" /> Sending code…
            </>
          ) : (
            <>
              Send reset code <ArrowRight size={17} />
            </>
          )}
        </button>
      </form>

      <p className="mt-7 text-center text-sm text-ink-500">
        Remembered it?{" "}
        <Link to="/" className="link">Back to sign in</Link>
      </p>
    </div>
  );
}
