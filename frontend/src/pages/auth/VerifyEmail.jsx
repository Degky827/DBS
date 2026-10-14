import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, MailCheck, RotateCw } from "lucide-react";
import OtpInput from "../../components/OtpInput";
import { verifyEmail, resendOtp } from "../../services/authService";

export default function VerifyEmail() {
  const navigate = useNavigate();
  const location = useLocation();
  const email = location.state?.email || "your registered email";

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
    if (code.length < 6) return;
    setSubmitting(true);
    setServerError("");

    try {
      await verifyEmail(email, code);
      navigate("/dashboard");
    } catch (err) {
      const msg = err.response?.data?.message || "Verification failed. Please try again.";
      setServerError(msg);
      setSubmitting(false);
    }
  };

  const resend = async () => {
    setResent(true);
    setCountdown(30);
    try {
      await resendOtp(email);
    } catch {
      // silently fail - don't reveal if email exists
    }
    setTimeout(() => setResent(false), 2500);
  };

  return (
    <div>
      <p className="eyebrow">Verification</p>
      <h1 className="mt-2 text-3xl font-extrabold">Confirm your email</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-500">
        We sent a 6-digit code to{" "}
        <span className="font-semibold text-navy-900">{email}</span>. Enter it below to
        activate your account.
      </p>

      {serverError && (
        <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-[13px] font-medium text-red-700">
          {serverError}
        </div>
      )}

      <div className="mt-7">
        <OtpInput value={otp} onChange={setOtp} onComplete={verify} />
      </div>

      <button
        type="button"
        className="btn-primary mt-6"
        disabled={otp.length < 6 || submitting}
        onClick={() => verify(otp)}
      >
        {submitting ? (
          <>
            <Loader2 size={17} className="animate-spin" /> Verifying…
          </>
        ) : (
          <>
            <MailCheck size={17} /> Verify email
          </>
        )}
      </button>

      <div className="mt-5 flex items-center justify-between text-[13px]">
        <Link to="/" className="inline-flex items-center gap-1.5 font-semibold text-ink-400 hover:text-navy-600">
          <ArrowLeft size={14} /> Change email
        </Link>
        <button
          type="button"
          onClick={resend}
          disabled={countdown > 0}
          className="inline-flex items-center gap-1.5 font-semibold text-navy-600 disabled:text-ink-400"
        >
          <RotateCw size={14} />
          {countdown > 0 ? `Resend in ${countdown}s` : "Resend code"}
        </button>
      </div>

      {resent && (
        <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] font-medium text-emerald-800">
          A new code has been sent to your email.
        </p>
      )}

      <div className="mt-8 rounded-lg border border-ink-200 bg-ink-50 px-4 py-3 text-[13px] leading-relaxed text-ink-500">
        Code expired? Request a new one above — codes are valid for 10 minutes and can
        be used once.
      </div>
    </div>
  );
}
