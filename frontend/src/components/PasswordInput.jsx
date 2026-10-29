import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

export default function PasswordInput({
  label,
  name,
  value,
  onChange,
  required = false,
  error,
  hint,
  autoComplete,
  disabled = false,
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <label htmlFor={name} className="field-label">
        {label}
        {required ? <span className="text-danger"> *</span> : null}
      </label>
      <div className="relative">
        <input
          id={name}
          name={name}
          type={visible ? "text" : "password"}
          value={value}
          onChange={onChange}
          required={required}
          disabled={disabled}
          autoComplete={autoComplete}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? `${name}-error` : hint ? `${name}-hint` : undefined}
          className="field-input pr-11"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={visible}
          disabled={disabled}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-muted transition hover:text-midnight disabled:opacity-50"
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {hint && !error ? (
        <p id={`${name}-hint`} className="mt-1.5 text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${name}-error`} className="field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
