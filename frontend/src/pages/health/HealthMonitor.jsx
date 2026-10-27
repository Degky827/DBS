import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Clock, ExternalLink, RefreshCw, XCircle } from "lucide-react";
import { getServicesHealth } from "../../services/healthService";
import { formatTime, formatUptime } from "../../utils/format";
import PageTransition, { StaggerGroup, StaggerItem } from "../../components/ui/PageTransition";
import PageHeader from "../../components/ui/PageHeader";

const STATUS_CONFIG = {
  healthy: {
    icon: CheckCircle2,
    label: "All systems operational",
    classes: "badge-success",
  },
  warning: {
    icon: AlertTriangle,
    label: "Degraded performance",
    classes: "badge-warning",
  },
  error: {
    icon: XCircle,
    label: "Service unavailable",
    classes: "badge-danger",
  },
};

const SERVICE_META = {
  "auth-service": {
    baseUrl: import.meta.env.VITE_AUTH_API,
    docsUrl: `${import.meta.env.VITE_AUTH_API}/docs`,
    description: "Registration, login, JWT sessions and password recovery.",
  },
  "user-service": {
    baseUrl: import.meta.env.VITE_USER_API,
    docsUrl: `${import.meta.env.VITE_USER_API}/docs`,
    description: "Profile management, avatar uploads and password changes.",
  },
  "kyc-service": {
    baseUrl: import.meta.env.VITE_KYC_API,
    docsUrl: `${import.meta.env.VITE_KYC_API}/docs`,
    description: "Identity documents, OCR, verification sessions and reviews.",
  },
};

export default function HealthMonitor() {
  const [services, setServices] = useState([]);
  const [lastChecked, setLastChecked] = useState(null);
  const [spinning, setSpinning] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setSpinning(true);
    try {
      const results = await getServicesHealth();
      setServices(results);
      setLastChecked(new Date());
    } finally {
      setSpinning(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    const checkHealth = () => {
      getServicesHealth()
        .then((results) => {
          if (!isMounted) return;
          setServices(results);
          setLastChecked(new Date());
        })
        .finally(() => {
          if (isMounted) setIsLoading(false);
        });
    };

    checkHealth();
    const id = setInterval(checkHealth, 30000);
    return () => {
      isMounted = false;
      clearInterval(id);
    };
  }, []);

  const healthyCount = services.filter((service) => service.status === "healthy").length;
  const overallStatus =
    services.length > 0 && healthyCount === services.length
      ? "healthy"
      : services.some((service) => service.status === "healthy")
        ? "warning"
        : "error";
  const status = STATUS_CONFIG[isLoading ? "warning" : overallStatus] || STATUS_CONFIG.warning;
  const StatusIcon = status.icon;

  return (
    <PageTransition className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="System health"
        description="Live connectivity checks against the auth, user and KYC services. Refreshes automatically every 30 seconds."
        actions={
          <button type="button" onClick={refresh} className="btn-ghost" disabled={spinning}>
            <RefreshCw size={15} className={spinning ? "animate-spin" : ""} />
            Refresh now
          </button>
        }
      />

      <StaggerGroup className="space-y-4">
        <StaggerItem className="card p-6">
          <div className="flex flex-wrap items-center gap-5">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-navy-50">
              <Activity size={26} className="text-navy-700" />
            </span>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-lg font-extrabold text-navy-900">Banking backend</h2>
                <span className={status.classes}>
                  <StatusIcon size={13} />
                  {isLoading
                    ? "Checking services"
                    : `${healthyCount}/${services.length} healthy`}
                </span>
              </div>
              <p className="mt-0.5 text-sm text-ink-500">
                {isLoading ? "Checking backend connectivity…" : status.label}
              </p>
            </div>
          </div>
        </StaggerItem>

        {services.map((service) => {
          const serviceStatus = STATUS_CONFIG[service.status] || STATUS_CONFIG.error;
          const ServiceIcon = serviceStatus.icon;
          const meta = SERVICE_META[service.name] || {};

          return (
            <StaggerItem key={service.name} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-[15px] font-extrabold text-navy-900">{service.name}</h3>
                    <span className={serviceStatus.classes}>
                      <ServiceIcon size={12} />
                      {service.status || "unknown"}
                    </span>
                  </div>
                  {meta.description ? (
                    <p className="mt-1 text-sm text-ink-500">{meta.description}</p>
                  ) : null}
                  {meta.baseUrl ? (
                    <p className="mt-1 font-mono text-xs text-ink-400">{meta.baseUrl}</p>
                  ) : null}
                </div>
                {meta.docsUrl ? (
                  <a
                    href={meta.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-secondary py-2 text-xs"
                  >
                    API docs <ExternalLink size={13} />
                  </a>
                ) : null}
              </div>

              {service.error ? (
                <p className="mt-3 text-xs leading-relaxed text-red-600">{service.error}</p>
              ) : (
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-500">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock size={12} /> Uptime: {formatUptime(service.uptime)}
                  </span>
                  <span>
                    Reported: {service.timestamp ? formatTime(new Date(service.timestamp)) : "—"}
                  </span>
                </div>
              )}
            </StaggerItem>
          );
        })}
      </StaggerGroup>

      <p className="text-xs text-ink-400">
        Last checked: {formatTime(lastChecked)} · Health endpoints are public and skip rate limiting.
      </p>
    </PageTransition>
  );
}
