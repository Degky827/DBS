import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, Check, X, Save, ArrowLeft } from "lucide-react";
import MainLayout from "../../layouts/MainLayout";
import FieldInput from "../../components/FieldInput";

const PASSWORD_RULES = [
  { label: "At least 12 characters long", test: (pw) => pw.length >= 12 },
  { label: "No more than 72 characters", test: (pw) => pw.length <= 72 },
  { label: "Must differ from current password", test: (pw, current) => pw !== current && pw.length > 0 },
];

export default function ChangePassword() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [errors, setErrors] = useState({});

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const newErrors = {};

    if (!form.currentPassword) newErrors.currentPassword = "Current password is required";
    if (!form.newPassword) {
      newErrors.newPassword = "New password is required";
    } else if (form.newPassword.length < 12) {
      newErrors.newPassword = "Password must be at least 12 characters";
    } else if (form.newPassword.length > 72) {
      newErrors.newPassword = "Password must not exceed 72 characters";
    } else if (form.newPassword === form.currentPassword) {
      newErrors.newPassword = "New password must differ from current password";
    }

    if (!form.confirmPassword) {
      newErrors.confirmPassword = "Please confirm your new password";
    } else if (form.newPassword !== form.confirmPassword) {
      newErrors.confirmPassword = "Passwords do not match";
    }

    setErrors(newErrors);
    if (Object.keys(newErrors).length === 0) {
      navigate("/profile");
    }
  };

  return (
    <MainLayout>
      <div className="mx-auto max-w-lg space-y-6">
        <div>
          <h1 className="text-2xl font-extrabold text-navy-900">Change Password</h1>
          <p className="mt-1 text-sm text-ink-500">Update your password to keep your account secure.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
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
                const passed = form.newPassword.length > 0 && rule.test(form.newPassword, form.currentPassword);
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
          </section>

          <div className="flex items-center justify-end gap-3 pb-4">
            <button
              type="button"
              onClick={() => navigate("/profile")}
              className="btn-ghost"
            >
              <ArrowLeft size={15} /> Cancel
            </button>
            <button type="submit" className="btn-primary w-auto! px-6!">
              <Save size={15} /> Update Password
            </button>
          </div>
        </form>
      </div>
    </MainLayout>
  );
}
