import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, Check, X, Save, ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import FieldInput from "../../components/FieldInput";
import { changePassword } from "../../services/userService";

const PASSWORD_RULES = [
  { label: "At least 8 characters long", test: (pw) => pw.length >= 8 },
  { label: "No more than 72 characters", test: (pw) => pw.length <= 72 },
  {
    label: "Must differ from current password",
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

    if (!form.currentPassword) {
      next.currentPassword = "Current password is required";
    }

    if (!form.newPassword) {
      next.newPassword = "New password is required";
    } else if (form.newPassword.length < 8) {
      next.newPassword = "Password must be at least 8 characters";
    } else if (form.newPassword.length > 72) {
      next.newPassword = "Password must not exceed 72 characters";
    } else if (form.newPassword === form.currentPassword) {
      next.newPassword = "New password must differ from current password";
    }

    if (!form.confirmPassword) {
      next.confirmPassword = "Please confirm your new password";
    } else if (form.newPassword !== form.confirmPassword) {
      next.confirmPassword = "Passwords do not match";
    }

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
      setTimeout(() => navigate("/profile/view"), 900);
    } catch (err) {
      const data = err.response?.data;
      let validationMessage;
      if (data?.errors && typeof data.errors === "object") {
        const fieldErrors = { ...data.errors };
        if (fieldErrors.confirmNewPassword) {
          fieldErrors.confirmPassword = fieldErrors.confirmNewPassword;
        }
        validationMessage = Object.values(fieldErrors).find(
          (message) => typeof message === "string"
        );
        setErrors((prev) => ({ ...prev, ...fieldErrors }));
      }
      setServerError(
        data?.message === "Validation failed" && validationMessage
          ? validationMessage
          : data?.message || "Unable to change your password. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg space-y-6">
        <div>
          <h1 className="text-2xl font-extrabold text-navy-900">Change Password</h1>
          <p className="mt-1 text-sm text-ink-500">Update your password to keep your account secure.</p>
        </div>

        {serverError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-[13px] font-medium text-red-700">
            {serverError}
          </div>
        )}

        {success && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-[13px] font-medium text-emerald-700">
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-6">
          <section className="card p-6">
            <h2 className="mb-5 text-[15px] font-extrabold text-navy-900">Password</h2>
            <div className="space-y-5">
              <FieldInput
                label="Current Password"
                name="currentPassword"
                type="password"
                value={form.currentPassword}
                onChange={handleChange}
                required
                error={errors.currentPassword}
              />
              <FieldInput
                label="New Password"
                name="newPassword"
                type="password"
                value={form.newPassword}
                onChange={handleChange}
                required
                error={errors.newPassword}
              />
              <FieldInput
                label="Confirm New Password"
                name="confirmPassword"
                type="password"
                value={form.confirmPassword}
                onChange={handleChange}
                required
                error={errors.confirmPassword}
              />
            </div>
          </section>

          <section className="card p-6">
            <div className="flex items-center gap-2">
              <KeyRound size={16} className="text-navy-600" />
              <h2 className="text-[15px] font-extrabold text-navy-900">Password Policy</h2>
            </div>
            <p className="mt-2 text-[13px] text-ink-500">
              Your password must meet the following requirements:
            </p>
            <ul className="mt-3 space-y-2">
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
                For your security, changing your password signs you out of all other active
                sessions and devices.
              </span>
            </div>
          </section>

          <div className="flex items-center justify-end gap-3 pb-4">
            <button
              type="button"
              onClick={() => navigate("/profile/view")}
              className="btn-ghost"
              disabled={submitting}
            >
              <ArrowLeft size={15} /> Cancel
            </button>
            <button type="submit" className="btn-primary w-auto! px-6!" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 size={15} className="animate-spin" /> Updating…
                </>
              ) : (
                <>
                  <Save size={15} /> Update Password
                </>
              )}
            </button>
          </div>
        </form>
      </div>
  );
}
