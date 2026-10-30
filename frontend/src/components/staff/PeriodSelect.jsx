export default function PeriodSelect({ value, onChange, label = "Period" }) {
  return (
    <label className="flex items-center gap-2 text-[12px] font-semibold text-muted">
      <span className="sr-only sm:not-sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="field-input !w-auto !py-2 text-[13px]"
      >
        <option value={7}>Last 7 days</option>
        <option value={30}>Last 30 days</option>
        <option value={90}>Last 90 days</option>
      </select>
    </label>
  );
}
