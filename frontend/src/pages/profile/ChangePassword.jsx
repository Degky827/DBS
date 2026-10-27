import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, Check, X, Save, ShieldCheck } from "lucide-react";
import FieldInput from "../../components/FieldInput";
import { changePassword } from "../../services/userService";
import { normalizeApiError } from "../../utils/apiError";
import PageTransition, { StaggerGroup, StaggerItem } from "../../components/ui/PageTransition";
import PageHeader from "../../components/ui/PageHeader";
import Alert from "../../components/ui/Alert";
import { Spinner } from "../../components/ui/Spinner";

// Mirrors the auth-service password policy (enforced when user-service
// proxies the change to auth-service in JWT mode).
const PASSWORD_RULES = [
  { label: "At least 8 characters long", test: (pw) => pw.length >= 8 },
  { label: "No more than 72 characters", test: (pw) => pw.length <= 72 },
  { label: "An uppercase and a lowercase letter", test: (pw) => /[a-z]/.test(pw) && /[A-Z]/.test(pw) },
  { label: "At least one number", test: (pw) => /\d/.test(pw) },
  {
    label: "Different from your current password",
    test: (pw, current) => pw.length > 0 && pw !== current,
  },
];

export default function ChangePassword() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState("");
  const [success, setSuccess] = useState("");

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  const validate = () => {
    const next = {};

    if (!form.currentPassword) next.currentPassword = "Current password is required";

    if (!form.newPassword) next.newPassword = "New password is required";
    else if (form.newPassword.length < 8) next.newPassword = "Password must be at least 8 characters";
    else if (form.newPassword.length > 72) next.newPassword = "Password must not exceed 72 characters";
    else if (!/[a-z]/.test(form.newPassword) || !/[A-Z]/.test(form.newPassword) || !/\d/.test(form.newPassword))
      next.newPassword = "Use uppercase, lowercase and a number";
    else if (form.newPassword === form.currentPassword)
      next.newPassword = "New password must differ from current password";

    if (!form.confirmPassword) next.confirmPassword = "Please confirm your new password";
    else if (form.newPassword !== form.confirmPassword) next.confirmPassword = "Passwords do not match";

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
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
      setSuccess(data?.message || "Password updated successfully. Other sessions were signed out.");
      setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (err) {
      const { message, fields } = normalizeApiError(err);
      const mapped = { ...fields };
      if (mapped.confirmNewPassword) {
        mapped.confirmPassword = mapped.confirmNewPassword;
        delete mapped.confirmNewPassword;
      }
      if (Object.keys(mapped).length) {
        setErrors((prev) => ({ ...prev, ...mapped }));
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
    <PageTransition className="mx-auto max-w-lg space-y-6">
      <PageHeader
        backTo="/profile"
        backLabel="Profile"
        eyebrow="Security"
        title="Change password"
        description="Choose a strong password. Changing it signs out every other active session."
      />

      <Alert tone="error">{serverError}</Alert>
      <Alert tone="success">{success}</Alert>

      <StaggerGroup as="form" onSubmit={handleSubmit} noValidate className="space-y-6">
        <StaggerItem className="card p-6">
          <h2 className="mb-5 text-[15px] font-extrabold text-navy-900">Password</h2>
          <div className="space-y-5">
            <FieldInput
              label="Current password"
              name="currentPassword"
              type="password"
              value={form.currentPassword}
              onChange={handleChange}
              required
              autoComplete="current-password"
              error={errors.currentPassword}
              disabled={submitting}
            />
            <FieldInput
              label="New password"
              name="newPassword"
              type="password"
              value={form.newPassword}
              onChange={handleChange}
              required
              autoComplete="new-password"
              error={errors.newPassword}
              disabled={submitting}
            />
            <FieldInput
              label="Confirm new password"
              name="confirmPassword"
              type="password"
              value={form.confirmPassword}
              onChange={handleChange}
              required
              autoComplete="new-password"
              error={errors.confirmPassword}
              disabled={submitting}
            />
          </div>
        </StaggerItem>

        <StaggerItem className="card p-6">
          <div className="flex items-center gap-2">
            <KeyRound size={16} className="text-navy-600" />
            <h2 className="text-[15px] font-extrabold text-navy-900">Password policy</h2>
          </div>
          <ul className="mt-4 space-y-2">
            {PASSWORD_RULES.map((rule) => {
              const passed =
                form.newPassword.length > 0 && rule.test(form.newPassword, form.currentPassword);
              return (
                <li key={rule.label} className="flex items-center gap-2.5 text-sm">
                  {passed ? (
                    <Check size={16} className="shrink-0 text-emerald-600" />
                  ) : (
                    <X size={16} className="shrink-0 text-ink-200" />
                  )}
                  <span className={passed ? "font-medium text-navy-900" : "text-ink-500"}>
                    {rule.label}
                  </span>
                </li>
              );
            })}
          </ul>

          <div className="mt-4 flex items-start gap-2 rounded-lg bg-navy-50 px-3 py-2.5 text-[12px] leading-relaxed text-navy-700">
            <ShieldCheck size={15} className="mt-0.5 shrink-0" />
            <span>
              For your security, changing your password revokes all other refresh tokens
              and signs out other devices.
            </span>
          </div>
        </StaggerItem>

        <StaggerItem className="flex items-center justify-end gap-3 pb-4">
          <button
            type="button"
            onClick={() => navigate("/profile")}
            className="btn-ghost"
            disabled={submitting}
          >
            Cancel
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
    </PageTransition>
  );
}
