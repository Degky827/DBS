import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  RefreshCw,
  XCircle,
} from "lucide-react";
import MainLayout from "../../layouts/MainLayout";
import { getHealth } from "../../mock/healthData";

const STATUS_CONFIG = {
  healthy: {
    icon: CheckCircle2,
    label: "All systems operational",
    classes: "bg-emerald-50 text-emerald-700",
    iconColor: "text-emerald-500",
  },
  warning: {
    icon: AlertTriangle,
    label: "Degraded performance",
    classes: "bg-gold-100 text-gold-600",
    iconColor: "text-gold-500",
  },
  error: {
    icon: XCircle,
    label: "Service unavailable",
    classes: "bg-red-50 text-red-600",
    iconColor: "text-red-500",
  },
};

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d} day${d === 1 ? "" : "s"}, ${h} hr`;
  if (h > 0) return `${h} hr ${m} min`;
  return `${m} min`;
}

export default function HealthMonitor() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [lastChecked, setLastChecked] = useState(null);
  const [spinning, setSpinning] = useState(false);

  const refresh = () => {
    getHealth().then((h) => {
      setData(h);
      setLastChecked(new Date());
      setSpinning(true);
      setTimeout(() => setSpinning(false), 600);
    });
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, []);

  const status = STATUS_CONFIG[data?.status] || STATUS_CONFIG.warning;
  const StatusIcon = status.icon;

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              className="link mb-3 text-[13px]!"
            >
              <ArrowLeft size={13} className="mr-1 inline" /> Back to overview
            </button>
            <p className="eyebrow">Operations</p>
            <h1 className="mt-1 text-2xl font-extrabold">Service health</h1>
            <p className="mt-1 text-sm text-ink-500">
              Live status of the user service — auto-refreshes every 30 seconds.
            </p>
          </div>
          <button type="button" onClick={refresh} className="btn-ghost">
            <RefreshCw size={15} className={spinning ? "animate-spin" : ""} />
            Refresh now
          </button>
        </div>

        <div className="card p-6">
          <div className="flex flex-wrap items-center gap-5">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-navy-50">
              <Activity size={26} className="text-navy-700" />
            </span>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-lg font-extrabold text-navy-900">
                  {data?.service || "user-service"}
                </h2>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${status.classes}`}
                >
                  <StatusIcon size={13} />
                  {data?.status || "unknown"}
                </span>
              </div>
              <p className="mt-0.5 text-sm text-ink-500">{status.label}</p>
            </div>
            <span className={`h-3 w-3 rounded-full bg-current ${status.iconColor}`} />
          </div>

          <div className="mt-6 grid gap-4 border-t border-ink-100 pt-5 sm:grid-cols-3">
            <div>
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-400">
                <Clock size={12} /> Uptime
              </p>
              <p className="num mt-1.5 text-xl font-extrabold text-navy-900">
                {data ? formatUptime(data.uptime) : "—"}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-400">
                Checked at
              </p>
              <p className="num mt-1.5 text-sm font-bold text-navy-900">
                {lastChecked ? lastChecked.toLocaleTimeString() : "—"}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-400">
                Report time
              </p>
              <p className="num mt-1.5 text-sm font-bold text-navy-900">
                {data?.timestamp
                  ? new Date(data.timestamp).toLocaleString("en-US", {
                      dateStyle: "medium",
                      timeStyle: "medium",
                    })
                  : "—"}
              </p>
            </div>
          </div>
        </div>

        <div className="card p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-400">
            Raw health payload
          </p>
          <pre className="num mt-3 overflow-x-auto rounded-lg bg-navy-900 p-4 font-mono text-xs leading-relaxed text-navy-100">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      </div>
    </MainLayout>
  );
}
