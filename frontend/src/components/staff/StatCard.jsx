const TONES = {
  brand: "bg-brand-50 text-brand-700",
  navy: "bg-navy-50 text-navy-700",
  success: "bg-[#ecfdf3] text-success",
  warning: "bg-[#fffbeb] text-warning",
  danger: "bg-[#fef2f2] text-danger",
  neutral: "bg-ink-100 text-ink-500",
};

export default function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "brand",
  loading = false,
}) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
            {label}
          </p>
          {loading ? (
            <div className="mt-3 h-8 w-24 animate-pulse rounded-md bg-ink-100" />
          ) : (
            <p className="num mt-2 truncate text-[26px] font-extrabold leading-none text-midnight">
              {value}
            </p>
          )}
        </div>
        {Icon ? (
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${TONES[tone] || TONES.brand}`}
          >
            <Icon size={17} strokeWidth={1.9} />
          </span>
        ) : null}
      </div>
      {hint ? (
        <p className="mt-2.5 text-[12px] leading-relaxed text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
