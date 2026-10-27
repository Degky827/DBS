import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, KeyRound } from "lucide-react";
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
      navigate("/", { state: { reset: true }, replace: true });
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
      <p className="eyebrow">Account recovery</p>
      <h1 className="mt-2 text-3xl font-extrabold">Set a new password</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-500">
        Paste the code from your email and choose a new password. All active sessions
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
          <input
            id="newPassword"
            type="password"
            className="field-input"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            aria-invalid={errors.password ? "true" : undefined}
          />
          <PasswordStrength password={password} />
          {errors.password && <p className="field-error">{errors.password}</p>}
        </div>

        <div>
          <label htmlFor="confirmPassword" className="field-label">Confirm new password</label>
          <input
            id="confirmPassword"
            type="password"
            className="field-input"
            placeholder="••••••••"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            aria-invalid={errors.confirm ? "true" : undefined}
          />
          {errors.confirm && <p className="field-error">{errors.confirm}</p>}
        </div>

        <button type="submit" className="btn-primary w-full" disabled={submitting}>
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

      <p className="mt-7 text-center text-sm text-ink-500">
        <Link to="/" className="link inline-flex items-center gap-1.5">
          <ArrowLeft size={14} /> Back to sign in
        </Link>
      </p>
    </div>
  );
}
