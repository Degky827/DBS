import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Eye, EyeOff, KeyRound } from "lucide-react";
import OtpInput from "../../components/OtpInput";
import PasswordStrength from "../../components/PasswordStrength";
import { scorePassword } from "../../utils/passwordScore";
import { resetPassword } from "../../services/authService";
import { normalizeApiError } from "../../utils/apiError";
import Alert from "../../components/ui/Alert";
import { Spinner } from "../../components/ui/Spinner";

export default function ResetPassword() {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState(location.state?.email || "");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!/^\S+@\S+\.\S+$/.test(email)) next.email = "Enter a valid email address";
    if (otp.length < 6) next.otp = "Enter the 6-digit code";
    if (scorePassword(password) < 1)
      next.password = "Use 8+ characters with uppercase, lowercase and a number";
    if (confirm !== password) next.confirm = "Passwords do not match";
    setErrors(next);
    if (Object.keys(next).length) return;

    setSubmitting(true);
    setServerError("");

    try {
      await resetPassword(email, otp, password, confirm);
      navigate("/login", { state: { reset: true }, replace: true });
    } catch (err) {
      const { message, fields } = normalizeApiError(err);
      setServerError(message);
      const mapped = { ...fields };
      if (mapped.confirmNewPassword) {
        mapped.confirm = mapped.confirmNewPassword;
        delete mapped.confirmNewPassword;
      }
      if (mapped.newPassword) {
        mapped.password = mapped.newPassword;
        delete mapped.newPassword;
      }
      if (Object.keys(mapped).length) setErrors(mapped);
      setSubmitting(false);
    }
  };

  return (
    <div>
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
        <KeyRound size={19} />
      </span>
      <h1 className="mt-4 text-[32px] font-extrabold leading-tight text-midnight">
        Set a new password
      </h1>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">
        Enter the code from your email and choose a new password. All active sessions
        will be signed out.
      </p>

      <Alert tone="error" className="mt-5">
        {serverError}
      </Alert>

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
            aria-invalid={errors.email ? "true" : undefined}
          />
          {errors.email && <p className="field-error">{errors.email}</p>}
        </div>

        <div>
          <label className="field-label">Reset code</label>
          <OtpInput value={otp} onChange={setOtp} />
          {errors.otp && <p className="field-error">{errors.otp}</p>}
        </div>

        <div>
          <label htmlFor="newPassword" className="field-label">New password</label>
          <div className="relative">
            <input
              id="newPassword"
              type={showPassword ? "text" : "password"}
              className="field-input pr-11"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              aria-invalid={errors.password ? "true" : undefined}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 transition hover:text-brand-600"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          <PasswordStrength password={password} />
          {errors.password && <p className="field-error">{errors.password}</p>}
        </div>

        <div>
          <label htmlFor="confirmPassword" className="field-label">Confirm new password</label>
          <div className="relative">
            <input
              id="confirmPassword"
              type={showConfirm ? "text" : "password"}
              className="field-input pr-11"
              placeholder="••••••••"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              aria-invalid={errors.confirm ? "true" : undefined}
            />
            <button
              type="button"
              onClick={() => setShowConfirm((v) => !v)}
              aria-label={showConfirm ? "Hide password confirmation" : "Show password confirmation"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 transition hover:text-brand-600"
            >
              {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {errors.confirm && <p className="field-error">{errors.confirm}</p>}
        </div>

        <button type="submit" className="btn-brand w-full" disabled={submitting}>
          {submitting ? (
            <>
              <Spinner size={17} /> Updating password…
            </>
          ) : (
            <>
              <KeyRound size={17} /> Reset password
            </>
          )}
        </button>
      </form>

      <p className="mt-7 text-center text-sm text-muted">
        <Link
          to="/login"
          className="inline-flex items-center gap-1.5 font-semibold text-brand-700 hover:underline"
        >
          <ArrowLeft size={14} /> Back to sign in
        </Link>
      </p>
    </div>
  );
}
