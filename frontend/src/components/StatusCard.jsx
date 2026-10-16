import { CheckCircle2, Clock, XCircle, AlertTriangle } from "lucide-react";

const STATUS_CONFIG = {
  complete: { icon: CheckCircle2, label: "Complete", classes: "bg-emerald-50 text-emerald-700" },
  in_progress: { icon: Clock, label: "In Progress", classes: "bg-gold-100 text-gold-600" },
  pending: { icon: AlertTriangle, label: "Pending", classes: "bg-ink-100 text-ink-500" },
  failed: { icon: XCircle, label: "Failed", classes: "bg-red-50 text-red-600" },
};

export default function StatusCard({ title, description, status = "pending" }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  const Icon = config.icon;

  return (
    <div className="card p-5 transition hover:border-navy-500/40 hover:shadow-[0_8px_24px_-16px_rgba(5,13,26,.45)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-extrabold text-navy-900">{title}</h3>
          <p className="mt-1 text-[13px] text-ink-500">{description}</p>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${config.classes}`}>
          <Icon size={13} />
          {config.label}
        </span>
      </div>
    </div>
  );
}
