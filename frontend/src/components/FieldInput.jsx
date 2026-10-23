export default function FieldInput({
  label,
  name,
  type = "text",
  value,
  onChange,
  placeholder,
  required = false,
  error,
  options,
  rows,
  disabled = false,
}) {
  const baseClasses = "field-input";

  return (
    <div>
      {label && (
        <label htmlFor={name} className="field-label">
          {label}
          {required && <span className="text-red-500"> *</span>}
        </label>
      )}

      {options ? (
        <select
          id={name}
          name={name}
          value={value}
          onChange={onChange}
          disabled={disabled}
          className={baseClasses}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : rows ? (
        <textarea
          id={name}
          name={name}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          rows={rows}
          disabled={disabled}
          className={`${baseClasses} resize-y`}
        />
      ) : (
        <input
          id={name}
          name={name}
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          className={baseClasses}
        />
      )}

      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
