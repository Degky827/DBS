import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  UserCog,
  Pencil,
  KeyRound,
  Server,
  Activity,
  GitBranch,
  Clock,
  CheckCircle2,
} from "lucide-react";
import MainLayout from "../../layouts/MainLayout";
import StatusCard from "../../components/StatusCard";
import { mockServiceInfo, mockPhases } from "../../mock/userService";

const QUICK_LINKS = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, desc: "Banking overview" },
  { to: "/profile", label: "View Profile", icon: UserCog, desc: "See your profile details" },
  { to: "/profile/edit", label: "Edit Profile", icon: Pencil, desc: "Update personal info" },
  { to: "/profile/change-password", label: "Change Password", icon: KeyRound, desc: "Update credentials" },
];

const STATUS_STYLES = {
  healthy: "bg-emerald-50 text-emerald-700",
  degraded: "bg-gold-100 text-gold-600",
  down: "bg-red-50 text-red-600",
};

export default function ServiceDashboard() {
  const navigate = useNavigate();

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-navy-800 text-white shadow-[0_8px_24px_-12px_rgba(5,13,26,.7)]">
              <Server size={26} />
            </span>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-2xl font-extrabold text-navy-900">{mockServiceInfo.name}</h1>
                <span className="rounded-full bg-navy-50 px-2.5 py-0.5 text-[11px] font-bold text-navy-600">
                  v{mockServiceInfo.version}
                </span>
                <span className="rounded-full bg-gold-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-gold-600">
                  {mockServiceInfo.authMode}
                </span>
              </div>
              <p className="mt-0.5 text-sm text-ink-500">
                Auth mode: <span className="font-semibold text-navy-700">{mockServiceInfo.authMode}</span>
              </p>
            </div>
          </div>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold ${STATUS_STYLES[mockServiceInfo.status] || STATUS_STYLES.healthy}`}>
            <Activity size={13} />
            {mockServiceInfo.status.charAt(0).toUpperCase() + mockServiceInfo.status.slice(1)}
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="card p-5">
            <div className="flex items-center gap-2 text-ink-400">
              <Activity size={15} />
              <p className="text-[11px] font-bold uppercase tracking-[0.14em]">Uptime</p>
            </div>
            <p className="num mt-2 text-2xl font-extrabold text-navy-900">{mockServiceInfo.uptime}</p>
            <p className="mt-1 text-xs text-ink-400">Last 30 days</p>
          </div>
          <div className="card p-5">
            <div className="flex items-center gap-2 text-ink-400">
              <GitBranch size={15} />
              <p className="text-[11px] font-bold uppercase tracking-[0.14em]">Version</p>
            </div>
            <p className="num mt-2 text-2xl font-extrabold text-navy-900">v{mockServiceInfo.version}</p>
            <p className="mt-1 text-xs text-ink-400">Stable release</p>
          </div>
          <div className="card p-5">
            <div className="flex items-center gap-2 text-ink-400">
              <Clock size={15} />
              <p className="text-[11px] font-bold uppercase tracking-[0.14em]">Last Deployed</p>
            </div>
            <p className="num mt-2 text-2xl font-extrabold text-navy-900">
              {new Date(mockServiceInfo.lastDeployed).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </p>
            <p className="mt-1 text-xs text-ink-400">
              {new Date(mockServiceInfo.lastDeployed).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
        </div>

        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-extrabold text-navy-900">Implementation Phases</h2>
            <span className="text-xs font-semibold text-ink-400">
              {mockPhases.filter((p) => p.status === "complete").length}/{mockPhases.length} complete
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {mockPhases.map((phase) => (
              <StatusCard
                key={phase.id}
                title={`Phase ${phase.id}: ${phase.name}`}
                description={phase.description}
                status={phase.status}
              />
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-lg font-extrabold text-navy-900">Quick Links</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {QUICK_LINKS.map(({ to, label, icon: Icon, desc }) => (
              <button
                key={to}
                type="button"
                onClick={() => navigate(to)}
                className="card group p-5 text-left transition hover:border-navy-500/40 hover:shadow-[0_8px_24px_-16px_rgba(5,13,26,.45)]"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy-50 text-navy-700 transition group-hover:bg-navy-800 group-hover:text-white">
                  <Icon size={18} />
                </span>
                <p className="mt-3 text-sm font-bold text-navy-900">{label}</p>
                <p className="mt-0.5 text-xs text-ink-400">{desc}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="card p-5">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-emerald-600" />
            <h2 className="text-[15px] font-extrabold text-navy-900">Service Health</h2>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "API Latency", value: "42ms" },
              { label: "Error Rate", value: "0.02%" },
              { label: "Requests/min", value: "1,240" },
              { label: "DB Connections", value: "8/20" },
            ].map((metric) => (
              <div key={metric.label} className="rounded-lg bg-ink-50 px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-400">{metric.label}</p>
                <p className="num mt-1 text-lg font-extrabold text-navy-900">{metric.value}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </MainLayout>
  );
}
