export default function FieldInput({
  label,
  name,
  type = "text",
  value,
  onChange,
  placeholder,
  required = false,
  error,
  hint,
  options,
  rows,
  disabled = false,
  autoComplete,
  min,
  max,
}) {
  const shared = {
    id: name,
    name,
    value,
    onChange,
    disabled,
    required,
    "aria-invalid": error ? "true" : undefined,
    "aria-describedby": error ? `${name}-error` : hint ? `${name}-hint` : undefined,
    className: "field-input",
  };

  return (
    <div>
      {label && (
        <label htmlFor={name} className="field-label">
          {label}
          {required && <span className="text-red-500"> *</span>}
        </label>
      )}

      {options ? (
        <select {...shared}>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : rows ? (
        <textarea {...shared} placeholder={placeholder} rows={rows} className={`${shared.className} resize-y`} />
      ) : (
        <input
          {...shared}
          type={type}
          placeholder={placeholder}
          autoComplete={autoComplete}
          min={min}
          max={max}
        />
      )}

      {hint && !error && (
        <p id={`${name}-hint`} className="mt-1.5 text-xs text-ink-400">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${name}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
