import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Check, KeyRound, Save, ShieldCheck, X } from "lucide-react";
import PasswordInput from "../../components/PasswordInput";
import { changePassword } from "../../services/userService";
import { normalizeApiError } from "../../utils/apiError";
import PageTransition, { StaggerGroup, StaggerItem } from "../../components/ui/PageTransition";
import PageHeader from "../../components/ui/PageHeader";
import Alert from "../../components/ui/Alert";
import { Spinner } from "../../components/ui/Spinner";

const PASSWORD_RULES = [
  { label: "At least 8 characters", test: (pw) => pw.length >= 8 },
  { label: "No more than 72 characters", test: (pw) => pw.length <= 72 },
  {
    label: "An uppercase and a lowercase letter",
    test: (pw) => /[a-z]/.test(pw) && /[A-Z]/.test(pw),
  },
  { label: "At least one number", test: (pw) => /\d/.test(pw) },
  {
    label: "Different from your current password",
    test: (pw, current) => pw.length > 0 && pw !== current,
  },
];

const EMPTY_FORM = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
};

export default function ChangePassword() {
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState("");
  const [success, setSuccess] = useState("");

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((previous) => ({ ...previous, [name]: value }));
    if (errors[name]) setErrors((previous) => ({ ...previous, [name]: undefined }));
    if (serverError) setServerError("");
  };

  const validate = () => {
    const next = {};

    if (!form.currentPassword) next.currentPassword = "Current password is required";

    if (!form.newPassword) next.newPassword = "New password is required";
    else if (form.newPassword.length < 8)
      next.newPassword = "Password must be at least 8 characters";
    else if (form.newPassword.length > 72)
      next.newPassword = "Password must not exceed 72 characters";
    else if (
      !/[a-z]/.test(form.newPassword) ||
      !/[A-Z]/.test(form.newPassword) ||
      !/\d/.test(form.newPassword)
    )
      next.newPassword = "Use uppercase, lowercase and a number";
    else if (form.newPassword === form.currentPassword)
      next.newPassword = "New password must differ from current password";

    if (!form.confirmPassword) next.confirmPassword = "Please confirm your new password";
    else if (form.newPassword !== form.confirmPassword)
      next.confirmPassword = "Passwords do not match";

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    setServerError("");
    setSuccess("");
    if (!validate()) return;

    setSubmitting(true);
    try {
      const data = await changePassword({
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
        confirmNewPassword: form.confirmPassword,
      });
      setSuccess(
        data?.message || "Password updated. Every other session has been signed out."
      );
      setForm(EMPTY_FORM);
      setErrors({});
    } catch (error) {
      const { message, fields } = normalizeApiError(error);
      const mapped = { ...fields };
      if (mapped.confirmNewPassword) {
        mapped.confirmPassword = mapped.confirmNewPassword;
        delete mapped.confirmNewPassword;
      }
      if (Object.keys(mapped).length) {
        setErrors((previous) => ({ ...previous, ...mapped }));
        const firstFieldError = Object.values(mapped)[0];
        setServerError(
          message === "Validation failed" && firstFieldError ? firstFieldError : message
        );
      } else {
        setServerError(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageTransition className="mx-auto max-w-xl space-y-6">
      <PageHeader
        backTo="/settings"
        backLabel="Settings"
        eyebrow="Security"
        title="Change password"
        description="Choose a strong password. Changing it revokes every other refresh session."
      />

      <Alert tone="error">{serverError}</Alert>
      {success ? (
        <div className="space-y-3">
          <Alert tone="success">{success}</Alert>
          <div className="flex flex-wrap items-center gap-3">
            <Link to="/settings" className="btn-primary">
              Back to settings
            </Link>
            <button
              type="button"
              onClick={() => setSuccess("")}
              className="btn-ghost"
            >
              Change it again
            </button>
          </div>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} noValidate>
        <StaggerGroup className="space-y-6">
          <StaggerItem className="card p-5 sm:p-6">
            <div className="mb-5 flex items-center gap-2">
              <KeyRound size={16} className="text-brand-700" />
              <h2 className="text-[14px] font-extrabold text-midnight">Password details</h2>
            </div>
            <div className="space-y-5">
              <PasswordInput
                label="Current password"
                name="currentPassword"
                value={form.currentPassword}
                onChange={handleChange}
                required
                autoComplete="current-password"
                error={errors.currentPassword}
                disabled={submitting}
              />
              <PasswordInput
                label="New password"
                name="newPassword"
                value={form.newPassword}
                onChange={handleChange}
                required
                autoComplete="new-password"
                error={errors.newPassword}
                disabled={submitting}
              />
              <PasswordInput
                label="Confirm new password"
                name="confirmPassword"
                value={form.confirmPassword}
                onChange={handleChange}
                required
                autoComplete="new-password"
                error={errors.confirmPassword}
                disabled={submitting}
              />
            </div>
          </StaggerItem>

          <StaggerItem className="card p-5 sm:p-6">
            <h2 className="text-[14px] font-extrabold text-midnight">Password requirements</h2>
            <ul className="mt-4 space-y-2" aria-label="Password requirements">
              {PASSWORD_RULES.map((rule) => {
                const passed =
                  form.newPassword.length > 0 &&
                  rule.test(form.newPassword, form.currentPassword);
                return (
                  <li key={rule.label} className="flex items-center gap-2.5 text-[13px]">
                    {passed ? (
                      <Check size={15} className="shrink-0 text-success" />
                    ) : (
                      <X size={15} className="shrink-0 text-ink-300" />
                    )}
                    <span className={passed ? "font-semibold text-midnight" : "text-muted"}>
                      {rule.label}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 flex items-start gap-2 rounded-lg bg-brand-50 px-3 py-2.5 text-[12px] leading-relaxed text-brand-800">
              <ShieldCheck size={15} className="mt-0.5 shrink-0" />
              <span>
                Passwords are sent only to the authentication service and are never written
                to logs or browser storage.
              </span>
            </div>
          </StaggerItem>

          <StaggerItem className="flex flex-wrap items-center justify-between gap-3 pb-4">
            <button
              type="button"
              onClick={() => navigate("/settings")}
              className="btn-ghost"
              disabled={submitting}
            >
              <ArrowLeft size={15} /> Cancel
            </button>
            <button type="submit" className="btn-primary px-6" disabled={submitting}>
              {submitting ? (
                <>
                  <Spinner size={15} /> Updating…
                </>
              ) : (
                <>
                  <Save size={15} /> Update password
                </>
              )}
            </button>
          </StaggerItem>
        </StaggerGroup>
      </form>
    </PageTransition>
  );
}
