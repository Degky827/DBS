const CHART_WIDTH = 640;const CHART_HEIGHT = 220;
const PADDING = { top: 16, right: 16, bottom: 30, left: 44 };

const formatDefault = (value) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);

export default function TrendChart({
  title,
  description,
  data = [],
  formatValue = formatDefault,
  emptyMessage = "No activity in this period.",
}) {
  const values = data.map((point) => Number(point.value) || 0);  const max = Math.max(...values, 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  const hasData = data.length > 0 && total > 0;

  const innerWidth = CHART_WIDTH - PADDING.left - PADDING.right;
  const innerHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;
  const step = data.length > 1 ? innerWidth / (data.length - 1) : innerWidth;

  const points = data.map((point, index) => {
    const value = Number(point.value) || 0;
    const x = PADDING.left + index * step;
    const y =
      max === 0
        ? PADDING.top + innerHeight
        : PADDING.top + innerHeight - (value / max) * innerHeight;
    return { x, y, value, label: point.label };
  });

  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area = points.length
    ? `${points[0].x},${PADDING.top + innerHeight} ${line} ${points[points.length - 1].x},${PADDING.top + innerHeight}`
    : "";

  const labelIndexes = new Set(
    [0, Math.floor((data.length - 1) / 2), data.length - 1].filter(
      (index) => index >= 0
    )
  );

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-extrabold text-midnight">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-[12px] text-muted">{description}</p>
          ) : null}
        </div>
        <p className="num text-[12px] font-bold text-ink-500">
          Total: {formatValue(total)}
        </p>
      </div>

      {!hasData ? (
        <p className="flex h-[180px] items-center justify-center text-[13px] text-muted">
          {emptyMessage}
        </p>
      ) : (
        <figure className="mt-4">
          <svg
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            role="img"
            aria-label={`${title}. ${description || ""}`}
            className="h-auto w-full"
          >
            <title>{title}</title>

            {[0, 0.5, 1].map((fraction) => {
              const y = PADDING.top + innerHeight * fraction;
              return (
                <g key={fraction}>
                  <line
                    x1={PADDING.left}
                    x2={CHART_WIDTH - PADDING.right}
                    y1={y}
                    y2={y}
                    stroke="#e4e8f0"
                    strokeWidth="1"
                  />
                  <text
                    x={PADDING.left - 8}
                    y={y + 4}
                    textAnchor="end"
                    className="fill-[#7a849a] text-[10px]"
                  >
                    {formatValue(max * (1 - fraction))}
                  </text>
                </g>
              );
            })}

            <polygon points={area} fill="#1769e0" fillOpacity="0.07" />
            <polyline
              points={line}
              fill="none"
              stroke="#1769e0"
              strokeWidth="2.25"
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {points.map((point, index) =>
              point.value > 0 ? (
                <circle
                  key={`point-${index}`}
                  cx={point.x}
                  cy={point.y}
                  r="2.6"
                  fill="#ffffff"
                  stroke="#1769e0"
                  strokeWidth="1.6"
                >
                  <title>{`${point.label}: ${formatValue(point.value)}`}</title>
                </circle>
              ) : null
            )}

            {points.map((point, index) =>
              labelIndexes.has(index) ? (
                <text
                  key={`label-${index}`}
                  x={point.x}
                  y={CHART_HEIGHT - 8}
                  textAnchor={
                    index === 0
                      ? "start"
                      : index === points.length - 1
                        ? "end"
                        : "middle"
                  }
                  className="fill-[#7a849a] text-[10px]"
                >
                  {point.label}
                </text>
              ) : null
            )}
          </svg>
          <figcaption className="sr-only">
            <table>
              <caption>{title}</caption>
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {data.map((point) => (
                  <tr key={point.label}>
                    <td>{point.label}</td>
                    <td>{formatValue(point.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </figcaption>
        </figure>
      )}
    </div>
  );
}
