const BAR_TONES = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  brand: "bg-brand-600",
  neutral: "bg-ink-300",
};

export default function DistributionList({
  title,
  description,
  items = [],
  emptyMessage = "No records in this period.",
}) {
  const total = items.reduce((sum, item) => sum + (item.value || 0), 0);

  return (
    <div className="card p-5">
      <h2 className="text-[15px] font-extrabold text-midnight">{title}</h2>
      {description ? (
        <p className="mt-0.5 text-[12px] text-muted">{description}</p>
      ) : null}

      {total === 0 ? (
        <p className="py-8 text-center text-[13px] text-muted">{emptyMessage}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {items.map((item) => {
            const percent = total ? Math.round((item.value / total) * 100) : 0;
            return (
              <li key={item.label}>
                <div className="flex items-center justify-between gap-3 text-[12.5px]">
                  <span className="font-semibold text-body">{item.label}</span>
                  <span className="num font-bold text-ink-500">
                    {item.value} · {percent}%
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-100">
                  <div
                    className={`h-full rounded-full ${BAR_TONES[item.tone] || BAR_TONES.brand}`}
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
