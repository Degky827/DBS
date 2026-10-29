import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff, ArrowRight, Lock } from "lucide-react";
import { loginUser } from "../../services/authService";
import { normalizeApiError } from "../../utils/apiError";
import Alert from "../../components/ui/Alert";
import { Spinner } from "../../components/ui/Spinner";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState("");

  const update = (key) => (e) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const validate = () => {
    const next = {};
    if (!/^\S+@\S+\.\S+$/.test(form.email)) next.email = "Enter a valid email address";
    if (!form.password) next.password = "Password is required";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    setServerError("");

    try {
      await loginUser(form.email, form.password);
      const from = location.state?.from?.pathname;
      navigate(from && from !== "/" && from !== "/login" ? from : "/dashboard", {
        replace: true,
      });
    } catch (err) {
      const { message, fields } = normalizeApiError(err);
      setServerError(message);
      if (Object.keys(fields).length) setErrors(fields);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-100 bg-brand-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-brand-700">
        <Lock size={12} /> Secure sign-in
      </span>
      <h1 className="mt-4 text-[32px] font-extrabold leading-tight text-midnight">
        Welcome back
      </h1>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">
        Sign in with the email address registered with Meridian Bank.
      </p>

      {location.state?.registered && !serverError && (
        <Alert tone="success" className="mt-5">
          Your account was created. Sign in to continue.
        </Alert>
      )}

      {location.state?.verified && !serverError && (
        <Alert tone="success" className="mt-5">
          Your email has been verified. Sign in to continue.
        </Alert>
      )}

      {location.state?.reset && !serverError && (
        <Alert tone="success" className="mt-5">
          Your password has been reset. Sign in with your new password.
        </Alert>
      )}

      <Alert tone="error" className="mt-5">
        {serverError}
      </Alert>

      <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-5">
        <div>
          <label htmlFor="email" className="field-label">
            Email address
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            className="field-input"
            placeholder="you@example.com"
            value={form.email}
            onChange={update("email")}
            aria-invalid={errors.email ? "true" : undefined}
          />
          {errors.email && <p className="field-error">{errors.email}</p>}
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="password" className="field-label">
              Password
            </label>
            <Link
              to="/forgot-password"
              className="text-[13px] font-semibold text-brand-600 hover:text-brand-700 hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              className="field-input pr-11"
              placeholder="••••••••"
              value={form.password}
              onChange={update("password")}
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
          {errors.password && <p className="field-error">{errors.password}</p>}
        </div>

        <button type="submit" className="btn-brand w-full" disabled={submitting}>
          {submitting ? (
            <>
              <Spinner size={17} /> Signing in…
            </>
          ) : (
            <>
              Sign in <ArrowRight size={17} />
            </>
          )}
        </button>
      </form>

      <div className="mt-8 rounded-xl border border-ink-200 bg-ink-50 px-4 py-3 text-[12.5px] leading-relaxed text-muted">
        New to Meridian?{" "}
        <Link to="/register" className="font-semibold text-brand-700 hover:underline">
          Open an account
        </Link>{" "}
        — registration takes about two minutes and ends with a one-time email code.
      </div>
    </div>
  );
}
