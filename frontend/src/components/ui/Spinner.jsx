import { Loader2 } from "lucide-react";

export function Spinner({ size = 18, className = "" }) {
  return <Loader2 size={size} className={`animate-spin ${className}`} aria-hidden="true" />;
}

export function LoadingBlock({ label = "Loading…", className = "" }) {
  return (
    <div
      className={`card flex items-center justify-center gap-3 px-5 py-16 text-sm font-semibold text-ink-500 ${className}`}
      role="status"
    >
      <Spinner className="text-navy-600" />
      {label}
    </div>
  );
}

export function Skeleton({ className = "" }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export default Spinner;
