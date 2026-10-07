import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff, ArrowRight, Loader2, Info } from "lucide-react";

export default function Login() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "", remember: true });
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const update = (key) => (e) =>
    setForm((f) => ({ ...f, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const validate = () => {
    const next = {};
    if (!/^\S+@\S+\.\S+$/.test(form.email)) next.email = "Enter a valid email address";
    if (!form.password) next.password = "Password is required";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    // UI-only demo: no backend call. Routes straight into the dashboard.
    setTimeout(() => navigate("/dashboard"), 700);
  };

  return (
    <div>
      <p className="eyebrow">Welcome back</p>
      <h1 className="mt-2 text-3xl font-extrabold">Sign in to your account</h1>
      <p className="mt-2 text-[15px] text-ink-500">
        Use the email address registered with Meridian Bank.
      </p>

      <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-navy-100 bg-navy-50 px-3.5 py-3 text-[13px] leading-relaxed text-navy-700">
        <Info size={15} className="mt-0.5 shrink-0 text-navy-500" />
        <span>
          Demo interface — submitting signs you in locally without contacting any server.
        </span>
      </div>

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
          />
          {errors.email && <p className="field-error">{errors.email}</p>}
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="password" className="field-label">
              Password
            </label>
            <Link to="/forgot-password" className="text-[13px] font-semibold text-navy-600 hover:underline">
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
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 transition hover:text-navy-600"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {errors.password && <p className="field-error">{errors.password}</p>}
        </div>

        <label className="flex cursor-pointer items-center gap-2.5 text-[13px] font-medium text-ink-500">
          <input
            type="checkbox"
            checked={form.remember}
            onChange={update("remember")}
            className="h-4 w-4 rounded border-ink-200 accent-navy-700"
          />
          Keep me signed in on this device
        </label>

        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 size={17} className="animate-spin" /> Signing in…
            </>
          ) : (
            <>
              Sign in <ArrowRight size={17} />
            </>
          )}
        </button>
      </form>

      <p className="mt-7 text-center text-sm text-ink-500">
        New to Meridian?{" "}
        <Link to="/register" className="link">
          Open an account
        </Link>
      </p>
    </div>
  );
}
