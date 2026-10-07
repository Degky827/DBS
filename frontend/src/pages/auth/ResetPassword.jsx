import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, KeyRound, Loader2 } from "lucide-react";
import OtpInput from "../../components/OtpInput";
import PasswordStrength from "../../components/PasswordStrength";
import { scorePassword } from "../../utils/passwordScore";

export default function ResetPassword() {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState(location.state?.email || "");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (e) => {
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
    // UI-only demo: no backend call.
    setTimeout(() => navigate("/"), 800);
  };

  return (
    <div>
      <p className="eyebrow">Account recovery</p>
      <h1 className="mt-2 text-3xl font-extrabold">Set a new password</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-500">
        Paste the code from your email and choose a new password. All active sessions
        will be signed out.
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
          />
          {errors.confirm && <p className="field-error">{errors.confirm}</p>}
        </div>

        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 size={17} className="animate-spin" /> Updating password…
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
