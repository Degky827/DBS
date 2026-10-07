export default function Logo({ light = false, size = "md" }) {
  const dims = size === "sm" ? "h-7 w-7" : size === "lg" ? "h-11 w-11" : "h-9 w-9";
  const text = size === "lg" ? "text-2xl" : "text-lg";

  return (
    <div className="flex items-center gap-3">
      <svg
        viewBox="0 0 40 40"
        className={`${dims} shrink-0`}
        aria-hidden="true"
        fill="none"
      >
        <rect width="40" height="40" rx="10" className="fill-navy-800" />
        <path
          d="M11 27V13.5L20 21l9-7.5V27"
          stroke="#d9b857"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M14.5 27h11" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
      <div className={`leading-none ${text}`}>
        <span
          className={`font-extrabold tracking-tight ${light ? "text-white" : "text-navy-900"}`}
        >
          Meridian
        </span>
        <span
          className={`ml-1.5 text-[11px] font-bold uppercase tracking-[0.22em] ${
            light ? "text-gold-400" : "text-gold-600"
          }`}
        >
          Bank
        </span>
      </div>
    </div>
  );
}
