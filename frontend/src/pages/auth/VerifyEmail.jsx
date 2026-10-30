import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, MailCheck, RotateCw } from "lucide-react";
import OtpInput from "../../components/OtpInput";
import { verifyEmail, resendOtp } from "../../services/authService";
import { normalizeApiError } from "../../utils/apiError";
import Alert from "../../components/ui/Alert";
import { Spinner } from "../../components/ui/Spinner";
import { useSelector } from "react-redux";

export default function VerifyEmail() {
  const navigate = useNavigate();
  const location = useLocation();
  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated);

  const [email, setEmail] = useState(location.state?.email || "");
  const [emailAsked] = useState(Boolean(location.state?.email));
  const [otp, setOtp] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [countdown, setCountdown] = useState(30);
  const [resent, setResent] = useState(false);
  const [serverError, setServerError] = useState("");

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const verify = async (code) => {
    if (code.length < 6 || !/^\S+@\S+\.\S+$/.test(email)) return;
    setSubmitting(true);
    setServerError("");

    try {
      await verifyEmail(email, code);
      if (isAuthenticated) navigate("/dashboard", { replace: true });
      else navigate("/login", { state: { verified: true }, replace: true });
    } catch (err) {
      const { message } = normalizeApiError(err);
      setServerError(message);
      setSubmitting(false);
    }
  };

  const resend = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setServerError("Enter a valid email address before requesting a new code.");
      return;
    }
    setResent(true);
    setCountdown(30);
    try {
      await resendOtp(email);
    } catch (err) {
      const { message } = normalizeApiError(err);
      setServerError(message);
    }
    setTimeout(() => setResent(false), 2500);
  };

  return (
    <div>
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
        <MailCheck size={20} />
      </span>
      <h1 className="mt-4 text-[32px] font-extrabold leading-tight text-midnight">
        Confirm your email
      </h1>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">
        {emailAsked ? (
          <>
            Enter the 6-digit code sent to{" "}
            <span className="font-semibold text-midnight">{email}</span>.
          </>
        ) : (
          "Enter your email address and the 6-digit code we sent you."
        )}
      </p>

      {!emailAsked && (
        <div className="mt-6">
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
        </div>
      )}

      <Alert tone="error" className="mt-5">
        {serverError}
      </Alert>

      <div className="mt-7">
        <OtpInput value={otp} onChange={setOtp} onComplete={verify} />
      </div>

      <button
        type="button"
        className="btn-brand mt-6 w-full"
        disabled={otp.length < 6 || submitting || !/^\S+@\S+\.\S+$/.test(email)}
        onClick={() => verify(otp)}
      >
        {submitting ? (
          <>
            <Spinner size={17} /> Verifying…
          </>
        ) : (
          <>
            <MailCheck size={17} /> Verify email
          </>
        )}
      </button>

      <div className="mt-5 flex items-center justify-between gap-3 text-[13px]">
        <Link
          to="/login"
          className="inline-flex items-center gap-1.5 font-semibold text-muted transition hover:text-midnight"
        >
          <ArrowLeft size={14} /> Back to sign in
        </Link>
        <button
          type="button"
          onClick={resend}
          disabled={countdown > 0}
          className="inline-flex items-center gap-1.5 font-semibold text-brand-700 transition disabled:text-ink-400"
        >
          <RotateCw size={14} />
          {countdown > 0 ? `Resend in ${countdown}s` : "Resend code"}
        </button>
      </div>

      <Alert tone="success" className="mt-4">
        {resent ? "A new code has been requested for your email." : ""}
      </Alert>

      <div className="mt-8 rounded-xl border border-ink-200 bg-ink-50 px-4 py-3 text-[12.5px] leading-relaxed text-muted">
        Codes are valid for 10 minutes and can be used once. Request a new one if yours
        has expired.
      </div>
    </div>
  );
}
