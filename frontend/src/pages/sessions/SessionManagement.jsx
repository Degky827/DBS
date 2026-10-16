import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Laptop,
  LogOut,
  MapPin,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import MainLayout from "../../layouts/MainLayout";
import { mockSessions, mockUser } from "../../mock/userService";

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default function SessionManagement() {
  const navigate = useNavigate();

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
            <p className="eyebrow">Security</p>
            <h1 className="mt-1 text-2xl font-extrabold">Active sessions</h1>
            <p className="mt-1 text-sm text-ink-500">
              Devices currently signed in as{" "}
              <span className="font-semibold text-navy-900">
                {mockUser.firstName} {mockUser.lastName}
              </span>{" "}
              · <span className="num">{mockUser.email}</span>
            </p>
          </div>
          <button type="button" className="btn-ghost">
            <LogOut size={15} /> Sign out all other sessions
          </button>
        </div>

        <ul className="space-y-4">
          {mockSessions.map((s) => {
            const DeviceIcon = /iphone|android|mobile/i.test(s.device)
              ? Smartphone
              : Laptop;
            return (
              <li key={s.id} className="card p-5">
                <div className="flex flex-wrap items-center gap-4">
                  <span
                    className={`flex h-11 w-11 items-center justify-center rounded-xl ${
                      s.current ? "bg-navy-800 text-white" : "bg-ink-50 text-ink-500"
                    }`}
                  >
                    <DeviceIcon size={19} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-bold text-navy-900">{s.device}</p>
                      {s.current && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                          <ShieldCheck size={12} /> Current session
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-400">
                      <span className="num">{s.ipAddress}</span>
                      <span className="inline-flex items-center gap-1">
                        <MapPin size={12} /> {s.location}
                      </span>
                      <span>
                        Last active{" "}
                        <span className="num font-semibold text-ink-500">
                          {timeAgo(s.lastActiveAt)}
                        </span>
                      </span>
                    </div>
                  </div>

                  {!s.current && (
                    <button type="button" className="btn-ghost py-2! text-xs">
                      <LogOut size={13} /> Sign out
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <p className="text-xs text-ink-400">
          Session IDs are shown in the user service format —{" "}
          <code className="num rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[11px] text-navy-800">
            sess_…
          </code>
          . Signing out revokes the dev session token locally.
        </p>
      </div>
    </MainLayout>
  );
}
